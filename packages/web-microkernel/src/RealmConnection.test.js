import Connection, * as internal from './RealmConnection.js'

it(`stringifies a value for debugging`, () => {
  expect(
    internal.inspect([{ a: `This is a very, very, very long string.` }])
  ).toEqual(`[{"a":"This is a very, very, very long s...`)
})

// a cheap exercise of the destructured clone operation that occurs between
// realm boundaries
const DestructuredClone = () => {
  const resolves = []

  window.addEventListener(`message`, ({ data }) => {
    const resolve = resolves.shift()
    resolve(data)
  })

  return value =>
    new Promise(resolve => {
      resolves.push(resolve)
      window.postMessage(value)
    })
}

const destructuredClone = DestructuredClone()

const MockRealm = origin => {
  let target

  return Object.assign(new EventTarget(), {
    // Connect to another realm.
    connect: realm => {
      target = realm
    },

    postMessage: async (message, targetOrigin) => {
      expect(targetOrigin).toEqual(origin)

      if (target) {
        const event = new MessageEvent(`message`, {
          data: await destructuredClone(message)
        })

        target.dispatchEvent(event)
      }
    }
  })
}

const createMockRealms = () => {
  const a = MockRealm(`a`)
  const b = MockRealm(`b`)
  a.connect(b)
  b.connect(a)
  return { a, b }
}

xdescribe(`type checkers`, () => {
  it(`array`, () => {
    expect(realms.is.array(null)).toEqual(false)
    expect(realms.is.array([1, 2, 3])).toEqual(true)
  })

  it(`boolean`, () => {
    expect(realms.is.boolean(null)).toEqual(false)
    expect(realms.is.boolean(true)).toEqual(true)
  })

  it(`function`, () => {
    expect(realms.is.function(null)).toEqual(false)
    expect(realms.is.function(() => {})).toEqual(true)
  })

  it(`map`, () => {
    expect(realms.is.map(null)).toEqual(false)
    expect(realms.is.map(new Map([[`a`, 1], [`b`, 2], [`c`, 3]]))).toEqual(true)
  })

  it(`null`, () => {
    expect(realms.is.null(undefined)).toEqual(false)
    expect(realms.is.null(null)).toEqual(true)
  })

  it(`number`, () => {
    expect(realms.is.number(null)).toEqual(false)
    expect(realms.is.number(42)).toEqual(true)
  })

  it(`plain object`, () => {
    expect(realms.is.object(null)).toEqual(false)
    expect(realms.is.object({ a: 1, b: 2, c: 3 })).toEqual(true)
  })

  it(`set`, () => {
    expect(realms.is.set(null)).toEqual(false)
    expect(realms.is.set(new Set([1, 2, 3]))).toEqual(true)
  })

  it(`string`, () => {
    expect(realms.is.string(null)).toEqual(false)
    expect(realms.is.string(`value`)).toEqual(true)
  })

  it(`undefined`, () => {
    expect(realms.is.undefined(null)).toEqual(false)
    expect(realms.is.undefined(undefined)).toEqual(true)
  })
})

// Create two test connections and serialize a value across them.
const serialize = async exports => {
  const { a, b } = createMockRealms()

  const connection1Promise = Connection({
    exports,
    input: a,
    output: a,
    outputOrigin: `a`
  })

  const connection2Promise = Connection({
    input: b,
    output: b,
    outputOrigin: `b`
  })

  const [connection1, connection2] = await Promise.all([
    connection1Promise,
    connection2Promise
  ])

  connection1.addEventListener(`error`, console.error)
  connection2.addEventListener(`error`, console.error)

  const close = () => {
    connection1.close()
    connection2.close()
  }

  return { close, imports: connection2.imports }
}

describe(`serializes values across realm boundaries`, () => {
  it(`creates consistent object references`, async () => {
    const object = { a: 1, b: 2, c: 3 }
    const exports = [object, object]
    const { close, imports } = await serialize(exports)
    const [left, right] = imports
    expect(left).toBe(right)
    close()
  })

  it(`freezes serialized values`, async () => {
    const exports = [{ a: 1 }]
    const { close, imports } = await serialize(exports)
    expect(Object.isFrozen(imports)).toEqual(true)
    expect(Object.isFrozen(imports[0])).toEqual(true)
    close()
  })

  it(`toJSON`, async () => {
    const { a, b } = createMockRealms()
    const wat = Symbol(`wat`)

    const exports = {
      value: wat,

      toJSON: () => ({
        type: `symbol`,
        description: `wat`
      })
    }

    const reviver = (key, value) =>
      value.type === `symbol` && value.description === `wat` ? wat : value

    const connection1Promise = Connection({
      exports,
      input: a,
      output: a,
      outputOrigin: `a`
    })

    const connection2 = await Connection({
      input: b,
      output: b,
      outputOrigin: `b`,
      reviver
    })

    const connection1 = await connection1Promise
    expect(connection2.imports).toEqual(wat)
    connection1.close()
    connection2.close()
  })

  it(`unsupported type`, async () => {
    const { a } = createMockRealms()
    const exports = Symbol(`description`)

    expectAsync(
      Connection({
        exports,
        input: a,
        output: a,
        outputOrigin: `a`
      })
    ).toBeRejected()
  })

  describe(`types`, () => {
    it(`array`, async () => {
      const exports = [1, 2, 3]
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`boolean`, async () => {
      const exports = true
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`Error`, async () => {
      const exports = Error(`message`)
      exports.name = `name`

      // Axios adds extra properties to errors.
      exports.extra = `extra`

      const { close, imports } = await serialize(exports)
      expect(imports instanceof Error).toEqual(true)
      expect(imports).toEqual(exports)
      close()
    })

    describe(`function`, () => {
      it(`has the same arguments length`, async () => {
        const exports = (a, b) => a + b
        const { close, imports } = await serialize(exports)
        expect(imports.length).toEqual(exports.length)
        close()
      })

      it(`encodes arguments`, async () => {
        const exports = async (a, b) => [a, b]
        const { close, imports } = await serialize(exports)
        const object = {}
        const [serializedA, serializedB] = await imports(object, object)
        expect(serializedA).not.toBe(object)
        expect(serializedA).toBe(serializedB)
        close()
      })

      it(`returns value`, async () => {
        const exports = async (a, b) => a + b
        const { close, imports } = await serialize(exports)
        expect(await imports(1, 2)).toEqual(3)
        close()
      })

      it(`allows functions only within exports`, async done => {
        const { a, b } = createMockRealms()
        const compose = async (f, g) => x => f(g(x))

        const connection1Promise = Connection({
          exports: compose,
          input: a,
          output: a,
          outputOrigin: `a`
        })

        const connection2 = await Connection({
          input: b,
          output: b,
          outputOrigin: `b`
        })

        const connection1 = await connection1Promise

        connection2.addEventListener(`error`, ({ error }) => {
          expect(error.exception.message).toEqual(
            `Cannot encode functions outside of exports.`
          )

          connection1.close()
          connection2.close()
          done()
        })

        connection2.imports(Math.cos, Math.sin)
      })

      it(`consistent identity`, async () => {
        const func = async (a, b) => a + b
        const exports = [func, func]
        const { close, imports } = await serialize(exports)
        const [left, right] = imports
        expect(left).toBe(right)
        close()
      })

      it(`throws exception`, async () => {
        const exports = async () => {
          throw new Error(`a tantrum`)
        }

        const { close, imports } = await serialize(exports)
        await expectAsync(imports()).toBeRejected()
        close()
      })
    })

    it(`map`, async () => {
      const exports = new Map([[`a`, 1], [`b`, 2], [`c`, 3]])
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`null`, async () => {
      const exports = null
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`number`, async () => {
      const exports = 42
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`object`, async () => {
      const exports = { a: 1, b: 2, c: 3 }
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`set`, async () => {
      const exports = new Set([1, 2, 3])
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })

    it(`undefined`, async () => {
      const exports = undefined
      const { close, imports } = await serialize(exports)
      expect(imports).toEqual(exports)
      close()
    })
  })
})

describe(`sanitize`, () => {
  it(`canSerialize`, () => {
    expect(internal.canSerialize(42)).toEqual(true)
    expect(internal.canSerialize(Symbol(`description`))).toEqual(false)
  })

  it(`removes non-serializable types`, () => {
    expect(internal.sanitize({ a: 1, b: Math.sin })).toEqual({ a: 1 })
    expect(internal.sanitize(Math.sin)).toEqual(null)
  })

  it(`is mutable`, () => {
    const immutable = Object.freeze({ a: { b: 1 } })
    const mutable = internal.sanitize(immutable)
    mutable.a.b = 2
    expect(mutable.a.b).toEqual(2)
  })

  it(`error`, () => {
    const error = Object.assign(new Error(`message`), {
      answer: 42,
      sin: Math.sin
    })

    const sanitized = internal.sanitize(error)
    expect(sanitized instanceof Error).toEqual(true)

    expect(Object.entries(sanitized)).toEqual(
      Object.entries(Object.assign(new Error(`message`), { answer: 42 }))
    )
  })

  it(`sanitizes functions`, async () => {
    const trickyFunction = async value => ({
      ...value,
      sin: Math.sin
    })

    expect(
      await internal.sanitizeFunction(trickyFunction)({
        answer: 42,
        cos: Math.cos
      })
    ).toEqual({ answer: 42 })
  })
})
