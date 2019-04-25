import * as router from 'connected-react-router'
import * as R from 'ramda'

import * as coreTypes from 'blockchain-wallet-v4/src/redux/actionTypes'
import * as types from '../data/actionTypes'

const alreadyForwarded = ({ meta }) => meta && meta.forwarded

const dispatchToBoth = ({ rootDocumentDispatch, next }, action) => {
  if (!alreadyForwarded(action)) {
    rootDocumentDispatch(action)
  }

  next(action)
}

const dispatchToRootDocument = ({ rootDocumentDispatch }, action) => {
  rootDocumentDispatch(action)
}

const tag = action => ({
  ...action,
  meta: { ...action.meta, forwarded: true }
})

const handlers = {
  // This requires the GUID.
  [coreTypes.data.misc.FETCH_LOGS]: dispatchToRootDocument,

  // This requires the GUID.
  [coreTypes.settings.FETCH_SETTINGS]: dispatchToRootDocument,

  // Tell the Root Document to merge our wrapper with its own.
  [coreTypes.wallet.MERGE_WRAPPER]: dispatchToRootDocument,

  // Inform the root document about routing changes so that it can switch which
  // application is displayed.
  [router.LOCATION_CHANGE]: dispatchToBoth,

  // Tell the root document to reload itself when we do.
  [types.auth.LOGOUT]: dispatchToBoth,

  // This requires the GUID.
  [types.modules.settings.UPDATE_LANGUAGE]: dispatchToRootDocument
}

export default ({ actionsChannel, rootDocumentDispatch }) => store => {
  // Now that we have access to the store, dispatch stored actions from the Root
  // Document to it.
  actionsChannel.forEach(store.dispatch)

  return next => action => {
    const { type } = action

    const context = {
      rootDocumentDispatch: R.pipe(
        tag,
        rootDocumentDispatch
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
