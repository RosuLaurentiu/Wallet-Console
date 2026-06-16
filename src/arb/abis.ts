export const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export const UNISWAP_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn,address[] calldata path) view returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) returns (uint256[] memory amounts)",
] as const;

export const UNISWAP_FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) view returns (address)",
] as const;
