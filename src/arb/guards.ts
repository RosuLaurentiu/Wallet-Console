import { getAddress, Interface } from "ethers";
import { ERC20_ABI } from "./abis";
import { APP_CONFIG, NATIVE_COTI } from "./config";
import type { PreparedStep } from "./types";
import { sameAddress } from "./utils";

const erc20Interface = new Interface(ERC20_ABI);

const ALLOWED_ETH_TOKENS = [
  APP_CONFIG.uniswap.coti,
  APP_CONFIG.uniswap.gcoti,
  APP_CONFIG.uniswap.usdc,
  APP_CONFIG.uniswap.weth,
].map((item) => item.toLowerCase());

function tokenAllowed(token: string, allowed: string[]): boolean {
  if (sameAddress(token, NATIVE_COTI)) return true;
  return allowed.includes(getAddress(token).toLowerCase());
}

function decodeApprovalSpender(data: string): string {
  const decoded = erc20Interface.decodeFunctionData("approve", data);
  return getAddress(String(decoded[0]));
}

function decodeTransferRecipient(data: string): string {
  const decoded = erc20Interface.decodeFunctionData("transfer", data);
  return getAddress(String(decoded[0]));
}

export function assertAllowedStep(step: PreparedStep, carbonTokens: string[]): void {
  const to = getAddress(step.tx.to);
  const value = BigInt(step.tx.value || 0);

  if (step.type === "approval") {
    const spender = decodeApprovalSpender(step.tx.data);
    if (step.chain === "ethereum") {
      if (!tokenAllowed(to, ALLOWED_ETH_TOKENS)) throw new Error("Ethereum approval uses an unknown token.");
      if (!sameAddress(spender, APP_CONFIG.uniswap.router)) throw new Error("Ethereum approval spender is not Uniswap.");
      if (value !== 0n) throw new Error("Approval unexpectedly sends native value.");
      return;
    }
    if (!tokenAllowed(to, carbonTokens)) throw new Error("Carbon approval uses an unknown token.");
    if (!sameAddress(spender, APP_CONFIG.carbonController)) throw new Error("Carbon approval spender is not Carbon.");
    if (value !== 0n) throw new Error("Approval unexpectedly sends native value.");
    return;
  }

  if (step.type === "uniswap-swap") {
    if (!sameAddress(to, APP_CONFIG.uniswap.router)) throw new Error("Uniswap swap target is not the router.");
    if (value !== 0n) throw new Error("Uniswap swap unexpectedly sends native value.");
    return;
  }

  if (step.type === "carbon-swap") {
    if (!sameAddress(to, APP_CONFIG.carbonController)) throw new Error("Carbon swap target is not the controller.");
    return;
  }

  if (step.type === "bridge-transfer") {
    throw new Error("Bridge transfers are not allowed in arb trade plans.");
  }

  throw new Error(`Unknown transaction step type: ${step.type}`);
}

export function assertAllowedPlan(steps: PreparedStep[], carbonTokens: string[]): void {
  for (const step of steps) assertAllowedStep(step, carbonTokens);
  const swapOrder = steps.filter((step) => step.type.endsWith("swap")).map((step) => step.type);
  if (swapOrder[0] !== "uniswap-swap" || swapOrder[1] !== "carbon-swap") {
    throw new Error("Prepared plan must execute Uniswap first and Carbon second.");
  }
}

export function assertAllowedRebalanceStep(step: PreparedStep, carbonGcotiAddress: string): void {
  const to = getAddress(step.tx.to);
  const value = BigInt(step.tx.value || 0);
  if (step.type !== "bridge-transfer") throw new Error("Rebalance plan can only contain bridge transfers.");

  if (step.chain === "ethereum") {
    if (!sameAddress(to, APP_CONFIG.uniswap.coti) && !sameAddress(to, APP_CONFIG.uniswap.gcoti)) {
      throw new Error("Ethereum bridge transfer uses an unknown token.");
    }
    if (!sameAddress(decodeTransferRecipient(step.tx.data), APP_CONFIG.bridge.ethereumRecipient)) {
      throw new Error("Ethereum bridge transfer recipient is not the official bridge recipient.");
    }
    if (value !== 0n) throw new Error("Ethereum bridge token transfer unexpectedly sends native value.");
    return;
  }

  if (step.chain === "coti") {
    if (sameAddress(to, APP_CONFIG.bridge.cotiRecipient)) {
      if (step.tx.data !== "0x") throw new Error("Native COTI bridge transfer unexpectedly includes calldata.");
      if (value <= 0n) throw new Error("Native COTI bridge transfer has no value.");
      return;
    }
    if (!sameAddress(to, carbonGcotiAddress)) throw new Error("COTI bridge transfer uses an unknown token.");
    if (!sameAddress(decodeTransferRecipient(step.tx.data), APP_CONFIG.bridge.cotiRecipient)) {
      throw new Error("COTI bridge transfer recipient is not the official bridge recipient.");
    }
    if (value !== 0n) throw new Error("COTI gCOTI bridge transfer unexpectedly sends native value.");
    return;
  }

  throw new Error("Unknown rebalance chain.");
}

export function assertAllowedRebalancePlan(steps: PreparedStep[], carbonGcotiAddress: string): void {
  if (steps.length < 1 || steps.length > 2) throw new Error("Rebalance plan must contain one or two bridge transfers.");
  for (const step of steps) assertAllowedRebalanceStep(step, carbonGcotiAddress);
}
