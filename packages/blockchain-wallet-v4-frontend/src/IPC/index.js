import Channel from '@nodeguy/channel'

import { serializer } from 'blockchain-wallet-v4/src/types'
import * as kernel from '../../../web-microkernel/src'

import Exports from './Exports'
import Middleware from './Middleware'

const rootDocumentRoutes = [
  `/help`,
  `/login`,
  `/recover`,
  `/reminder`,
  `/reset-2fa`,
  `/security-center`,
  `/signup`
]

export default () => {
  // The middleware dispatches actions to the Main Process store but we need to
  // provide the middleware before we can import the Main Process's `dispatch`
  // method.  Create a channel for buffering actions to be dispatched once it's
  // available.
  const mainProcessActionsChannel = Channel()

  return {
    Connection: async ({ input, output, outputOrigin, store }) => {
      const connection = await kernel.RealmConnection({
        exports: Exports({ store }),
        input,
        output,
        outputOrigin,
        reviver: serializer.reviver
      })

      mainProcessActionsChannel.forEach(connection.imports.dispatch)
      return connection
    },

    middleware: Middleware({
      mainProcessDispatch: mainProcessActionsChannel.push,
      rootDocumentRoutes
    })
  }
}
