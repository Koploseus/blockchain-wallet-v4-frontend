import * as _ from './lodash-es/lodash.js'

const fromEntries = entries =>
  Object.assign({}, ...entries.map(([key, value]) => ({ [key]: value })))

// Polyfill the behavior of addEventListener(type, listener, { once: true }))
// because for an unknown reason the above isn't working in Chrome 72.
const addEventListenerOnce = (target, type, listener) => {
  const onceListener = (...args) => {
    const result = listener(...args)
    target.removeEventListener(type, onceListener)
    return result
  }

  target.addEventListener(type, onceListener)
}

const firstEvent = (target, type) =>
  new Promise(resolve => {
    addEventListenerOnce(target, type, resolve)
  })

const inspectionCutoff = 40

export const inspect = value => {
  const stringified = JSON.stringify(value)

  return stringified.length > inspectionCutoff
    ? `${stringified.slice(0, inspectionCutoff)}...`
    : stringified
}

// Create an unforgeable key.
const Key = () => {
  const array = new Uint32Array(1)
  window.crypto.getRandomValues(array)
  return array[0].toString(36)
}

const decoders = {}
const types = []

// The types are defined in the same order they are tested.

types.push(
  {
    name: `boolean`,
    test: _.isBoolean,
    encode: (context, boolean) => boolean,
    decode: (context, code) => code
  },

  {
    name: `null`,
    test: _.isNull,
    encode: () => null,
    decode: () => null
  },

  {
    name: `number`,
    test: _.isNumber,
    encode: (context, number) => number,
    decode: (context, code) => code
  },

  {
    name: `string`,
    test: _.isString,
    encode: (context, string) => string,
    decode: (context, code) => code
  },

  {
    name: `undefined`,
    test: _.isUndefined,
    encode: () => undefined,
    decode: () => undefined
  },

  {
    name: `array`,
    test: Array.isArray,
    encode: (context, array) =>
      array.map((value, index) =>
        context.memoizedEncode(context, value, index)
      ),

    decode: (context, codes) =>
      codes.map((code, index) => context.memoizedDecode(context, code, index))
  }
)

// error

const isError = value => value instanceof Error

const encodeError = (context, error) => ({
  // The `message` property has to be handled separately.
  message: context.memoizedEncode(context, error.message),

  // Encode all properties (not just standard `message` and `name`) for
  // the benefit of Axios.
  entries: encodeObject(context, error)
})

const decodeError = (context, { entries, message }) =>
  Object.assign(
    Error(context.memoizedDecode(context, message)),
    decodeObject(context, entries)
  )

types.push({
  name: `error`,
  test: isError,
  encode: encodeError,
  decode: decodeError
})

// function

const encodeFunction = ({ functionKeys, keyedReferences }, func) => {
  if (!keyedReferences) {
    throw new TypeError(`Cannot encode functions outside of exports.`)
  }

  if (!functionKeys.has(func)) {
    const key = Key()
    functionKeys.set(func, key)
    keyedReferences[key] = func
  }

  return { key: functionKeys.get(func), length: func.length }
}

const decodeFunction = (context, { key: functionKey, length }) => {
  const { keyedReferences, reportExceptionsIn } = context

  if (!(functionKey in keyedReferences)) {
    const proxyFunction = (...args) =>
      new Promise(
        reportExceptionsIn((resolve, reject) => {
          const returnValueKey = Key()
          keyedReferences[returnValueKey] = { resolve, reject }

          // Function application isn't a type so encode it manually.
          context.postMessage([
            `functionApply`,
            {
              args: encodeWithoutPersistentReferences(context, args),
              functionKey,
              returnValueKey
            }
          ])
        })
      )

    Object.defineProperty(proxyFunction, `length`, { value: length })
    keyedReferences[functionKey] = proxyFunction
  }

  return keyedReferences[functionKey]
}

decoders.functionApply = (context, { args, functionKey, returnValueKey }) => {
  const { keyedReferences, postMessage, reportExceptionsIn } = context
  const func = keyedReferences[functionKey]
  const decodedArgs = decode(context, args)

  const functionReturn = key =>
    reportExceptionsIn(value => {
      // Function return isn't a type so encode it manually.
      postMessage([
        `functionReturn`,
        {
          returnValueKey,
          [key]: encodeWithoutPersistentReferences(context, value)
        }
      ])
    })

  Promise.resolve(func(...decodedArgs)).then(
    functionReturn(`value`),
    functionReturn(`reason`)
  )
}

decoders.functionReturn = (context, { returnValueKey, reason, value }) => {
  const { keyedReferences } = context
  const { reject, resolve } = keyedReferences[returnValueKey]
  delete keyedReferences[returnValueKey]

  if (reason) {
    reject(decode(context, reason))
  } else {
    resolve(decode(context, value))
  }
}

types.push({
  name: `function`,
  test: _.isFunction,
  encode: encodeFunction,
  decode: decodeFunction
})

// map

const encodeMap = (context, map) =>
  [...map.entries()].map(([key, value]) => [
    context.memoizedEncode(context, key),
    context.memoizedEncode(context, value, key)
  ])

const decodeMap = (context, pairs) =>
  new Map(
    pairs.map(([encodedKey, encodedValue]) => {
      const key = context.memoizedDecode(context, encodedKey)
      const value = context.memoizedDecode(context, encodedValue, key)
      return [key, value]
    })
  )

types.push({
  name: `map`,
  test: _.isMap,
  encode: encodeMap,
  decode: decodeMap
})

// set

const encodeSet = (context, set) =>
  [...set].map(value => context.memoizedEncode(context, value))

const decodeSet = (context, codes) =>
  new Set(codes.map(code => context.memoizedDecode(context, code)))

types.push({
  name: `set`,
  test: _.isSet,
  encode: encodeSet,
  decode: decodeSet
})

// object

const encodeObject = (context, object) =>
  Object.entries(object).map(([key, value]) => [
    key,
    context.memoizedEncode(context, value, key)
  ])

const decodeObject = (context, entries) =>
  fromEntries(
    entries.map(([key, encodedValue]) => [
      key,
      context.memoizedDecode(context, encodedValue, key)
    ])
  )

types.push({
  name: `object`,
  test: _.isPlainObject,
  encode: encodeObject,
  decode: decodeObject
})

// end of type definitions

types.forEach(({ name, decode }) => {
  decoders[name] = decode
})

const encodeWithType = (context, value, key = ``) => {
  let json

  try {
    json = value.toJSON(key)
  } catch (exception) {
    const type = types.find(({ test }) => test(value))

    if (type) {
      return [type.name, type.encode(context, value)]
    } else {
      throw new TypeError(`Don't know how to encode "${inspect(value)}".`)
    }
  }

  return encodeWithType(context, json, key)
}

const memoizeResolver = (context, value) => value

const encode = (context, value) => {
  const memoizedEncode = _.memoize(encodeWithType, memoizeResolver)

  try {
    return memoizedEncode({ ...context, memoizedEncode }, value)
  } catch (exception) {
    throw Object.assign(
      new Error(`Exception while encoding ${inspect(value)}`),
      { exception, value }
    )
  }
}

const encodeWithoutPersistentReferences = (context, value) =>
  encode(
    {
      ...context,
      functionKeys: null,
      keyedReferences: null
    },
    value
  )

const decodeFromType = (context, code, key = ``) => {
  const [type, encoding] = code
  const decode = decoders[type]

  if (decode === undefined) {
    throw new TypeError(`Don't know how to decode type ${inspect(type)}.`)
  }

  const value = decode(context, encoding)
  const revived = context.reviver(key, value)

  // Freeze the newly created value because it's read-only:  Changes wouldn't
  // otherwise propogate back to the original value in the other realm.
  try {
    return Object.freeze(revived)
  } catch (exception) {
    // Some types cannot be frozen (e.g., array buffer views with elements).
    return revived
  }
}

const decode = (context, code) => {
  const memoizedDecode = _.memoize(decodeFromType, memoizeResolver)
  return memoizedDecode({ ...context, memoizedDecode }, code)
}

const defaultReviver = (key, value) => value

const ReportExceptionsIn = eventTarget => callback => (...args) => {
  try {
    return callback(...args)
  } catch (exception) {
    eventTarget.dispatchEvent(
      new ErrorEvent(`error`, {
        error: exception,
        message: exception.message
      })
    )
  }
}

export const canSerialize = value =>
  Boolean(types.find(({ test }) => test(value)))

const isSanitary = value => !_.isFunction(value) && canSerialize(value)

const sanitizeError = error =>
  Object.assign(new Error(error.message), sanitizeObject(error))

const sanitizeObject = object =>
  fromEntries(
    Object.entries(object)
      .filter(([, value]) => isSanitary(value))
      .map(([key, value]) => [key, sanitize(value)])
  )

export const sanitize = value =>
  isError(value)
    ? sanitizeError(value)
    : _.isPlainObject(value)
    ? sanitizeObject(value)
    : isSanitary(value)
    ? value
    : null

export const sanitizeFunction = callback => async (...args) => {
  try {
    return sanitize(await callback(...args.map(sanitize)))
  } catch (exception) {
    throw sanitize(exception)
  }
}

export default async ({
  exports,
  input,
  output,
  outputOrigin,
  reviver = defaultReviver
}) => {
  const postMessage = message => {
    // console.log(`-> ${outputOrigin} ${JSON.stringify(message)}`)
    output.postMessage(message, outputOrigin)
  }

  const eventTarget = new EventTarget()
  const reportExceptionsIn = ReportExceptionsIn(eventTarget)

  const context = {
    functionKeys: new Map(),
    keyedReferences: {},
    postMessage,
    reportExceptionsIn,
    reviver
  }

  const postExports = () => postMessage(encode(context, exports))
  postExports()
  const { data } = await firstEvent(input, `message`)
  const imports = decode(context, data)

  // We've already posted our exports but post them a second time in case the
  // other realm wasn't listening yet.  The fact that we've received a handshake
  // means they're listening now.  Posting the exports is idempotent.
  postExports()

  // Now that we've completed the handshake, listen for all future message
  // events.

  const messageListener = reportExceptionsIn(({ data }) => {
    // console.log(`<- ${JSON.stringify(data)}`)
    decode(context, data)
  })

  input.addEventListener(`message`, messageListener)

  return Object.assign(eventTarget, {
    close: () => {
      input.removeEventListener(`message`, messageListener)
    },

    imports
  })
}
