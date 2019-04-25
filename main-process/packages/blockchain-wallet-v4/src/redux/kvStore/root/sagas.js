import { call, put, select } from 'redux-saga/effects'
import { prop, compose, isNil } from 'ramda'
import * as A from './actions'
import { KVStoreEntry } from '../../../types'
import { getPbkdf2Iterations, getSharedKey } from '../../wallet/selectors'

const taskToPromise = t =>
  new Promise((resolve, reject) => t.fork(reject, resolve))

export default ({ api, networks, rootDocument }) => {
  const callTask = function*(task) {
    return yield call(
      compose(
        taskToPromise,
        () => task
      )
    )
  }
  const createRoot = function*({ password }) {
    try {
      const credentials = {
        iterations: yield select(getPbkdf2Iterations),
        secondPassword: password,
        sharedKey: yield select(getSharedKey)
      }

      const metadata = yield call(rootDocument.deriveBIP32Key, credentials, {
        network: networks.btc,
        path: `m/${KVStoreEntry.metadataPurpose}'`
      })

      yield put(A.updateMetadataRoot({ metadata }))
    } catch (e) {
      throw new Error('create root Metadata :: Error decrypting mnemonic')
    }
  }

  const fetchRoot = function*({ askSecondPasswordEnhancer }) {
    try {
      const sharedKey = yield select(getSharedKey)
      yield put(A.fetchMetadataRootLoading())
      const entropy = yield call(rootDocument.credentialsEntropy, { sharedKey })

      const kv = yield call(KVStoreEntry.fromEntropy, {
        entropy,
        network: networks.btc
      })

      const newkv = yield callTask(api.fetchKVStore(kv))
      yield put(A.fetchMetadataRootSuccess(newkv))
      if (isNil(prop('metadata', newkv.value))) {
        // no metadata node saved
        const createRootenhanced = askSecondPasswordEnhancer(createRoot)
        yield call(createRootenhanced, {})
      }
    } catch (e) {
      yield put(A.fetchMetadataRootFailure(e.message))
    }
  }

  return {
    fetchRoot
  }
}
