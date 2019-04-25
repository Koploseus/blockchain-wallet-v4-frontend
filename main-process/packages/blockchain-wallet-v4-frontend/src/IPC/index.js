import Channel from '@nodeguy/channel'

import { serializer } from 'blockchain-wallet-v4/src/types'
import Middleware from './Middleware'
import * as kernel from '../../../web-microkernel/src'

export default async ({ input, output, outputOrigin }) => {
  // We need to export a function for dispatching actions from the Root
  // Document before the store is created so use a channel to save them until
  // the store is ready.
  const actionsChannel = Channel()

  const connection = await kernel.RealmConnection({
    exports: { dispatch: actionsChannel.push },
    input,
    output,
    outputOrigin,
    reviver: serializer.reviver
  })

  return {
    connection,

    middleware: Middleware({
      actionsChannel,
      rootDocumentDispatch: connection.imports.dispatch
    })
  }
}
