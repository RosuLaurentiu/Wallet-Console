import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { ERC20_ABI } from "./abis";
import { APP_CONFIG, NATIVE_COTI } from "./config";
import { assertAllowedPlan, assertAllowedStep } from "./guards";
import type { PreparedStep } from "./types";
import { isAllowedWallet } from "./utils";

const erc20 = new Interface(ERC20_ABI);

function step(overrides: Partial<PreparedStep>): PreparedStep {
  return {
    chain: "ethereum",
    description: "test",
    index: 1,
    label: "test",
    token: "COTI",
    tx: {
      data: "0x",
      from: APP_CONFIG.allowedWallet,
      to: APP_CONFIG.uniswap.router,
      value: "0x0",
    },
    type: "uniswap-swap",
    ...overrides,
  };
}

describe("wallet gate", () => {
  it("accepts only the configured wallet", () => {
    expect(isAllowedWallet("0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d")).toBe(true);
    expect(isAllowedWallet("0x0000000000000000000000000000000000000001")).toBe(false);
  });
});

describe("transaction guards", () => {
  const carbonTokens = [NATIVE_COTI, "0xaf2ca40d3fc4459436d11b94d21fa4b8a89fb51d", "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C"];

  it("allows DEX approvals and swaps in Uniswap then Carbon order", () => {
    const plan = [
      step({
        chain: "ethereum",
        tx: {
          data: erc20.encodeFunctionData("approve", [APP_CONFIG.uniswap.router, 100n]),
          from: APP_CONFIG.allowedWallet,
          to: APP_CONFIG.uniswap.coti,
          value: "0x0",
        },
        type: "approval",
      }),
      step({ chain: "ethereum", type: "uniswap-swap", tx: { data: "0x1234", from: APP_CONFIG.allowedWallet, to: APP_CONFIG.uniswap.router, value: "0x0" } }),
      step({ chain: "coti", type: "carbon-swap", tx: { data: "0x1234", from: APP_CONFIG.allowedWallet, to: APP_CONFIG.carbonController, value: "0x0" } }),
    ];
    expect(() => assertAllowedPlan(plan, carbonTokens)).not.toThrow();
  });

  it("rejects direct transfers and bad spenders", () => {
    expect(() => assertAllowedStep(step({
      chain: "ethereum",
      tx: { data: "0x", from: APP_CONFIG.allowedWallet, to: APP_CONFIG.uniswap.coti, value: "0x0" },
      type: "uniswap-swap",
    }), carbonTokens)).toThrow(/router/i);

    expect(() => assertAllowedStep(step({
      chain: "ethereum",
      tx: {
        data: erc20.encodeFunctionData("approve", ["0x0000000000000000000000000000000000000001", 100n]),
        from: APP_CONFIG.allowedWallet,
        to: APP_CONFIG.uniswap.coti,
        value: "0x0",
      },
      type: "approval",
    }), carbonTokens)).toThrow(/spender/i);
  });

  it("rejects non-Uniswap-first ordering", () => {
    expect(() => assertAllowedPlan([
      step({ chain: "coti", type: "carbon-swap", tx: { data: "0x1234", from: APP_CONFIG.allowedWallet, to: APP_CONFIG.carbonController, value: "0x0" } }),
      step({ chain: "ethereum", type: "uniswap-swap", tx: { data: "0x1234", from: APP_CONFIG.allowedWallet, to: APP_CONFIG.uniswap.router, value: "0x0" } }),
    ], carbonTokens)).toThrow(/Uniswap first/i);
  });
});
