import axios from 'axios'
import BIP39 from 'bip39'
import Bitcoin from 'bitcoinjs-lib'
import * as ed25519 from 'ed25519-hd-key'

import {
  getDefaultHDWallet,
  getGuid,
  getMainPassword
} from 'blockchain-wallet-v4/src/redux/wallet/selectors'

import { HDWallet } from 'blockchain-wallet-v4/src/types'
import * as crypto from 'blockchain-wallet-v4/src/walletCrypto'
import * as kernel from '../../../web-microkernel/src'

export default ({ store }) => {
  const credentialsEntropy = ({ sharedKey }) => {
    const state = store.getState()
    const guid = getGuid(state)
    const password = getMainPassword(state)
    return crypto.sha256(Buffer.from(guid + sharedKey + password))
  }

  const getSeed = ({ iterations, secondPassword, sharedKey }) => {
    const state = store.getState()
    const candidate = HDWallet.selectSeedHex(getDefaultHDWallet(state))

    const entropy = secondPassword
      ? crypto.decryptSecPass(sharedKey, iterations, secondPassword, candidate)
      : candidate

    return BIP39.mnemonicToSeed(BIP39.entropyToMnemonic(entropy))
  }

  const deriveBIP32Key = (
    { iterations, secondPassword, sharedKey },
    { network, path }
  ) => {
    const seed = getSeed({ iterations, secondPassword, sharedKey })

    return Bitcoin.HDNode.fromSeedBuffer(seed, network)
      .derivePath(path)
      .toBase58()
  }

  const deriveSLIP10ed25519Key = (
    { iterations, secondPassword, sharedKey },
    { path }
  ) => {
    const seed = getSeed({ iterations, secondPassword, sharedKey })
    return ed25519.derivePath(path, seed.toString(`hex`))
  }

  return {
    axios: kernel.sanitizeFunction(axios),
    credentialsEntropy,
    deriveBIP32Key,
    deriveSLIP10ed25519Key,
    dispatch: store.dispatch
  }
}
