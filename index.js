const axios = require('axios')
const uuid = require('uuid').v1

module.exports = function (config) {
  const baseUrl = `http${config.https ? 's' : ''}://${config.host}:${config.port || 4368}`
  const publicUrl = `http${config.https ? 's' : ''}://${config.publicHost || config.host}:${config.port || 4368}`
  return function (req, res, next) {
    const secretKeys = req.get('x-gt-secret-keys') ? req.get('x-gt-secret-keys').split(',') : []
    const requestId = req.requestId || res.locals.requestId || req.get('x-request-id') || uuid()
    const requestUid = req.requestUid || res.locals.requestUid || uuid()
    const requestFromUid = req.requestFromUid || res.locals.requestFromUid || req.get('x-request-from-uid')
    req.gt = {}
    req.gadgetTrace = req.gt
    req.requestId = res.locals.requestId = requestId
    req.requestUid = res.locals.requestUid = requestUid
    if (requestFromUid) req.requestFromUid = res.locals.requestFromUid = requestFromUid
    res.setHeader('x-request-id', requestId)
    res.setHeader('x-request-uid', requestUid)
    if (requestFromUid) res.setHeader('x-request-from-uid', requestFromUid)

    if (config.secret && !secretKeys.includes(config.secret)) {
      req.gt.wrap = () => {}
      req.gt.log = () => {}
      return next()
    }

    res.setHeader('x-gt-host', publicUrl)

    const startTime = process.hrtime()

    req.gt.vars = function gadgetTraceVars (vars) {
      let variables = []
      for (let name in vars) {
        variables.push({ name, value: vars[name] })
      }
      req.gt.log({ variables }, requestUid)
    }

    req.gt.log = function gadgetTraceLog (data, requestUid = null) {
      if (!requestUid) {
        requestUid = uuid()
      }
      data.requestId = requestId
      data.requestUid = requestUid
      if (requestUid === req.requestUid) {
        data.requestFromUid = req.requestFromUid
      } else {
        data.requestFromUid = req.requestUid
      }
      if (config.secret) {
        data.secret = config.secret
      }
      axios({
        method: 'post',
        url: `${baseUrl}/request/${requestId}`,
        data: data
      }).catch(() => {
        // TODO log the failure
      })
    }

    req.gt.log({
      url: req.originalUrl,
      method: req.method,
      protocol: req.protocol,
      requestHeaders: req.headers,
      xhr: req.xhr,
      request: req.body || req.query,
      cookies: req.cookies,
      ip: req.ip
    }, requestUid)

    res.on('finish', function () {
      const duration = process.hrtime(startTime)
      const seconds = durationSeconds(duration)
      req.gt.log({
        duration: seconds,
        statusCode: res.statusCode,
        responseHeaders: res.getHeaders(),
        response: body
      }, requestUid)
    })

    req.gt.wrap = function (fn, name, options = {}, maxDepth = 4, depth = 0) {
      if (fn !== null && typeof fn === 'object') {
        if (depth >= maxDepth) return
        Object.keys(fn).forEach(key => {
          if (options.blacklist && new RegExp(options.blacklist).test(key)) return
          if (options.whitelist && !(new RegExp(options.whitelist).test(key))) return
          const wrapped = req.gt.wrap(fn[key], `${name}.${key}`, options, maxDepth, depth + 1)
          if (typeof fn[key] === 'function') {
            fn[key] = wrapped
          }
        })
        return fn
      } else if (typeof fn === 'function') {
        const argNames = getArgNames(fn)
        return function () {
          const args = []
          const ret = fn.apply(this, arguments)
          for (var i = 0; i < arguments.length || i < argNames.length; ++i) {
            args.push({ name: argNames[i], value: arguments[i] })
          }
          // TODO support callbacks instead of assuming a promise will be returned
          let trace = (new Error()).stack
          const traceStart = process.hrtime()
          Promise.resolve(ret).then(response => {
            const duration = process.hrtime(traceStart)
            const seconds = durationSeconds(duration)
            req.gt.log({
              fn: name || fn.name || 'unknown',
              args: args,
              response: response,
              duration: seconds,
              trace: trace
            })
          })
          return ret
        }
      }
    }

    let body = ''
    let write = res.write
    let end = res.end
    res.write = function (data) {
      body = body + data.toString()
      write.apply(res, arguments)
    }
    res.end = function (data) {
      if (data) body = body + data.toString()
      end.apply(res, arguments)
    }

    next()
  }
}

function getArgNames (fn) {
  // TODO handle arrow funcs without parens
  return fn.toString().split(/\(|\)/)[1].split(',').map(argName => argName.trim()).filter(v => v)
}

function durationSeconds (duration) {
  return duration[0] * 1e3 + duration[1] * 1e-6
}
