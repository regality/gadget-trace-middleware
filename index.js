const axios = require('axios')
const uuid = require('uuid').v1

module.exports = function (config) {
  return function (req, res, next) {
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

    const startTime = process.hrtime()

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
      axios({
        method: 'post',
        url: `http://${config.host}:${config.port || 4368}/request/${requestId}`,
        data: data
      }).catch(() => {})
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

    req.gt.wrap = function (fn, name, depth = 0, maxDepth = 4) {
      if (fn !== null && typeof fn === 'object') {
        if (depth >= maxDepth) return
        Object.keys(fn).forEach(key => {
          const wrapped = req.gt.wrap(fn[key], `${name}.${key}`, depth + 1, maxDepth)
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
