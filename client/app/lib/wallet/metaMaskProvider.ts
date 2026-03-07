import type { EIP1193Provider } from "viem";

type MetaMaskProvider = EIP1193Provider & {
  isMetaMask?: true;
  providers?: MetaMaskProvider[];
};

type MetaMaskInjectedWindow = {
  ethereum?: MetaMaskProvider;
};

const isMetaMaskProvider = (provider: MetaMaskProvider | undefined): provider is MetaMaskProvider =>
  Boolean(provider?.isMetaMask);

export function getMetaMaskProvider(inputWindow?: MetaMaskInjectedWindow): MetaMaskProvider | undefined {
  const win =
    inputWindow ??
    (typeof window !== "undefined" ? ((window as unknown) as MetaMaskInjectedWindow) : undefined);

  if (!win?.ethereum) return undefined;

  const { ethereum } = win;
  if (Array.isArray(ethereum.providers)) {
    return ethereum.providers.find((provider: MetaMaskProvider) => isMetaMaskProvider(provider));
  }

  return isMetaMaskProvider(ethereum) ? ethereum : undefined;
}
