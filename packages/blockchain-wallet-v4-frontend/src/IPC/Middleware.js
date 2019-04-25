import * as router from 'connected-react-router'
import * as R from 'ramda'

import * as coreTypes from 'blockchain-wallet-v4/src/redux/actionTypes'
import * as types from '../data/actionTypes'

const alreadyForwarded = ({ meta }) => meta && meta.forwarded

const tag = action => ({
  ...action,
  meta: { ...action.meta, forwarded: true }
})

const appElement = document.getElementById(`app`)
const frameElement = document.getElementById(`frame`)
const mainProcessElement = document.getElementById(`main-process`)

const displayRootDocument = () => {
  appElement.style.display = `block`
  frameElement.style.borderColor = `lightgreen`
  mainProcessElement.style.display = `none`
}

const displayMainProcess = () => {
  appElement.style.display = `none`
  frameElement.style.borderColor = `red`
  mainProcessElement.style.display = `block`
}

const dispatchToBoth = ({ mainProcessDispatch, next }, action) => {
  if (!alreadyForwarded(action)) {
    mainProcessDispatch(action)
  }

  next(action)
}

const wrapperMask = {
  password: undefined,
  wallet: {
    guid: undefined,
    hd_wallets: [{ seedHex: undefined }]
  }
}

const handlers = {
  // This requires the GUID.
  [coreTypes.data.misc.FETCH_LOGS_FAILURE]: dispatchToBoth,
  [coreTypes.data.misc.FETCH_LOGS_LOADING]: dispatchToBoth,
  [coreTypes.data.misc.FETCH_LOGS_SUCCESS]: dispatchToBoth,

  // Dispatched by createRoot, which requires the mnemonic.
  [coreTypes.kvStore.root.UPDATE_METADATA_ROOT]: dispatchToBoth,

  // Dispatched by createXlm, which requires the mnemonic.
  [coreTypes.kvStore.xlm.CREATE_METADATA_XLM]: dispatchToBoth,

  // This requires the GUID.
  [coreTypes.settings.FETCH_SETTINGS_FAILURE]: dispatchToBoth,
  [coreTypes.settings.FETCH_SETTINGS_LOADING]: dispatchToBoth,
  [coreTypes.settings.FETCH_SETTINGS_SUCCESS]: dispatchToBoth,

  // Report failure of wallet synchronization.
  [coreTypes.walletSync.SYNC_ERROR]: dispatchToBoth,

  // Report success of wallet synchronization.
  [coreTypes.walletSync.SYNC_SUCCESS]: dispatchToBoth,

  // Proceed with the login routine after receiving the payload.
  [types.auth.AUTHENTICATE]: dispatchToBoth,
  [types.auth.LOGIN_ROUTINE]: dispatchToBoth
}

// Used to set the wrapper in /recover.

handlers[coreTypes.wallet.REFRESH_WRAPPER] = (
  { mainProcessDispatch, next },
  action
) => {
  const redactedPayload = action.payload.mergeDeep(wrapperMask)
  mainProcessDispatch({ ...action, payload: redactedPayload })
  next(action)
}

// Send the wrapper to the Main Process after logging in.
handlers[coreTypes.wallet.SET_WRAPPER] =
  handlers[coreTypes.wallet.REFRESH_WRAPPER]

export default ({ mainProcessDispatch, rootDocumentRoutes }) => {
  const routeIsInRootDocument = pathname =>
    rootDocumentRoutes.some(route => pathname.startsWith(route))

  handlers[router.LOCATION_CHANGE] = (
    { mainProcessDispatch, next, store },
    action
  ) => {
    const { pathname } = action.payload.location

    if (routeIsInRootDocument(pathname)) {
      displayRootDocument()

      const isNewLocationFromMainProcess =
        alreadyForwarded(action) &&
        pathname !== store.getState().router.location.pathname

      const nextAction = isNewLocationFromMainProcess
        ? router.replace(pathname)
        : action

      next(nextAction)
    } else {
      displayMainProcess()
      mainProcessDispatch(action)
    }
  }

  return store => next => action => {
    const { type } = action

    const context = {
      mainProcessDispatch: R.pipe(
        tag,
        mainProcessDispatch
      ),
      next,
      store
    }

    if (type in handlers) {
      return handlers[type](context, action)
    } else {
      return next(action)
    }
  }
}
