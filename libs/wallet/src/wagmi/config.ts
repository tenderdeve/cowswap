import { RPC_URLS, VIEM_CHAINS } from '@cowprotocol/common-const'
import { getCurrentChainIdFromUrl, isImTokenBrowser, isInjectedWidget } from '@cowprotocol/common-utils'
import { SupportedChainId } from '@cowprotocol/cow-sdk'
import { WidgetEthereumProvider } from '@cowprotocol/iframe-transport'

import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { injected, safe } from '@wagmi/connectors'
import { EIP1193Provider, http } from 'viem'
import { createConfig, createStorage, type Config, type Transport } from 'wagmi'

import { COW_WIDGET_CONNECTOR_ID, SUPPORTED_REOWN_NETWORKS } from '../reown/consts'

type ConnectorInstance = ReturnType<typeof safe> | ReturnType<typeof injected>

/**
 * True when the app is running inside a cross-origin iframe (e.g. Safe App).
 * Accessing window.parent.location.href throws a SecurityError for cross-origin frames.
 * Same-origin iframes (e.g. local dev) do not throw.
 */
export const IS_CROSS_ORIGIN_IFRAME = (() => {
  if (typeof window === 'undefined' || window.self === window.top) return false
  try {
    void window.parent.location.href
    return false
  } catch {
    return true
  }
})()

// Skip AppKit in the Safe iframe (interferes with postMessage flow) and in the widget
// (browser extensions are per-origin singletons — AppKit's WagmiAdapter amplifies their
// accountsChanged events across same-origin tabs, causing cross-tab wallet sync).
// Both use plain wagmi configs. The widget connects via injected extensions directly
// through wagmi's connect(), without AppKit's reactive layer.
const skipAppKit = IS_CROSS_ORIGIN_IFRAME || isInjectedWidget()

function getConnectors(): ConnectorInstance[] {
  // Widget context — checked BEFORE the cross-origin iframe check because the widget
  // can be same-origin (e.g. widget-configurator uses the same baseUrl).
  if (isInjectedWidget()) {
    return [
      injected({
        shimDisconnect: true,
        target: {
          name: 'CoW Widget',
          id: COW_WIDGET_CONNECTOR_ID,
          provider: new WidgetEthereumProvider() as EIP1193Provider,
        },
      }),
      // Plain injected connector for standalone mode — lets users connect browser extensions
      // directly via wagmi's connect() without AppKit.
      injected({ shimDisconnect: true }),
      // Include Safe connector so the widget can auto-connect when hosted inside a Safe app
      safe({ shimDisconnect: true }),
    ]
  }

  if (IS_CROSS_ORIGIN_IFRAME) {
    // Safe iframe: only the safe connector is needed. Do NOT include the plain `injected`
    // connector — MetaMask is a per-origin singleton and fires `accountsChanged` across all
    // same-origin frames. This causes the Safe iframe to briefly switch to the regular tab's
    // wallet on connect/disconnect, then snap back to the Safe wallet.
    return [safe({ shimDisconnect: true })]
  }

  return [injected({ shimDisconnect: true })]
}

const wagmiTransports = SUPPORTED_REOWN_NETWORKS.reduce(
  (acc, chain) => {
    const chainId = chain.id as SupportedChainId
    const url = RPC_URLS[chainId]
    if (url) {
      acc[chainId] = http(url)
    }
    return acc
  },
  {} as Record<SupportedChainId, Transport>,
)

/** CAIP-shaped RPCs for AppKit UI / network metadata (pairs with `wagmiTransports`). */
const customRpcUrls: Record<string, Array<{ url: string }>> = {}
for (const chain of SUPPORTED_REOWN_NETWORKS) {
  const url = RPC_URLS[chain.id as SupportedChainId]
  if (url) {
    customRpcUrls[`eip155:${chain.id}`] = [{ url }]
  }
}

const projectId = 'ac287751638b5d374a03c39e37f70376'

// Use a distinct storage key per context to avoid cross-context session pollution.
const WAGMI_STORAGE_KEY = isInjectedWidget()
  ? 'cowswap-wallet' + COW_WIDGET_CONNECTOR_ID
  : IS_CROSS_ORIGIN_IFRAME
    ? 'cowswap-wallet-safe'
    : 'cowswap-wallet'

// Use sessionStorage for the widget — it's per-browsing-context, so no cross-tab
// `storage` events fire. This fully isolates the widget's wagmi + AppKit state from
// the regular app tab, even though they share the same origin.
const storageBackend = isInjectedWidget() ? window?.sessionStorage : window?.localStorage

const storage =
  typeof window === 'undefined'
    ? createStorage({
        storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      })
    : createStorage({
        storage: storageBackend,
        key: WAGMI_STORAGE_KEY,
      })

const metadata = {
  name: 'CoW Swap | The smartest way to trade cryptocurrencies',
  description:
    'CoW Swap finds the lowest prices from all decentralized exchanges and DEX aggregators & saves you more with p2p trading and protection from MEV',
  url: 'https://swap.cow.fi',
  icons: ['https://swap.cow.fi/apple-touch-icon.png'],
}

const connectors = getConnectors()

let wagmiAdapter: WagmiAdapter | null = null
let reownAppKit: ReturnType<typeof createAppKit> | null = null
let config: Config

if (skipAppKit) {
  // Safe iframe or widget: no AppKit — plain wagmi config.
  config = createConfig({
    connectors,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chains: SUPPORTED_REOWN_NETWORKS as any,
    storage,
    transports: wagmiTransports,
  })
} else {
  wagmiAdapter = new WagmiAdapter({
    connectors: connectors as ConstructorParameters<typeof WagmiAdapter>[0]['connectors'],
    customRpcUrls,
    networks: SUPPORTED_REOWN_NETWORKS,
    projectId,
    storage,
    transports: wagmiTransports,
  })

  config = wagmiAdapter.wagmiConfig

  reownAppKit = createAppKit({
    adapters: [wagmiAdapter],
    allowUnsupportedChain: true,
    customRpcUrls,
    defaultNetwork: VIEM_CHAINS[getCurrentChainIdFromUrl()],
    // Disable EIP-6963 inside imToken's browser: AppKit's EIP-6963 path calls eth_requestAccounts
    // through too many async layers, losing the iOS WebKit gesture context — the call hangs forever.
    // imToken is instead featured as a WalletConnect option (featuredWalletIds) so it appears on
    // the first modal screen, and the WalletConnect path works correctly inside imToken's browser.
    enableEIP6963: !isImTokenBrowser,
    enableReconnect: true,
    enableWalletGuide: false,
    featuredWalletIds: [
      'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
      // imToken — shown prominently so users inside imToken's browser can find the WalletConnect path
      'ef333840daf915aafdc4a004525502d6d49d77bd9c65e0642dbaefb3c2893bef',
    ],
    features: {
      analytics: false,
      email: false,
      socials: false,
      connectorTypeOrder: ['injected', 'recent', 'walletConnect'],
    },
    metadata,
    networks: SUPPORTED_REOWN_NETWORKS,
    projectId,
    termsConditionsUrl:
      'https://cow.fi/legal/cowswap-terms?utm_source=swap.cow.fi&utm_medium=web&utm_content=wallet-modal-terms-link',
  })
}

export { wagmiAdapter, reownAppKit, config }
