const axios = require('axios')
const uuid = require('uuid').v1

module.exports = function (config) {
  return function (req, res, next) {
    const requestId = req.requestId || res.locals.requestId || req.get('x-request-id') || uuid()
    const requestUid = req.requestUid || res.locals.requestUid || uuid()
    req.requestId = res.locals.requestId = requestId
    req.requestUid = res.locals.requestUid = requestUid
    res.setHeader('x-request-id', requestId)
    res.setHeader('x-request-uid', requestUid)

    const startTime = process.hrtime()

    logData(config, requestId, null, requestUid, { // TODO find the real from id
      url: req.originalUrl,
      method: req.method,
      protocol: req.protocol,
      requestHeaders: req.headers,
      xhr: req.xhr,
      received: req.body || req.query,
      cookies: req.cookies,
      ip: req.ip
    })

    res.on('finish', function () {
      const duration = process.hrtime(startTime)
      const seconds = durationSeconds(duration)
      logData(config, requestId, null, requestUid, { // TODO find the real from id
        duration: seconds,
        statusCode: res.statusCode,
        responseHeaders: res.headers,
        response: body
      })
    })

    req.traceWrap = function (fn, name, depth = 0, maxDepth = 4) { // TODO call capture instead?
      if (depth >= maxDepth) return
      if (fn !== null && typeof fn === 'object') {
        Object.keys(fn).forEach(key => {
          fn[key] = req.traceWrap(fn[key], `${name}.${key}`, depth + 1, maxDepth)
        })
        return fn
      } else if (typeof fn === 'function') {
        if (fn.toString().includes('getTemplate')) console.log(JSON.stringify(fn.toString()) + ',\n')
        const argNames = getArgNames(fn)
        return function () {
          const args = []
          const ret = fn.apply(this, arguments)
          for (var i = 0; i < arguments.length || i < argNames.length; ++i) {
            args.push({ name: argNames[i], value: arguments[i] })
          }
          // TODO support callbacks
          let trace = (new Error()).stack
          const traceStart = process.hrtime()
          Promise.resolve(ret).then(response => {
            const duration = process.hrtime(traceStart)
            const seconds = durationSeconds(duration)
            logData(config, requestId, requestUid, uuid(), { // TODO send/honor uuid
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

function logData (config, requestId, requestFromUid, requestUid, data) {
  data.request_id = requestId
  data.request_uid = requestUid
  data.request_from_uid = requestFromUid
  axios({
    method: 'post',
    url: `http://${config.host}:${config.port || 4368}/request/${requestId}`,
    data: data
  }).catch(() => {})
}

function durationSeconds (duration) {
  return duration[0] * 1e3 + duration[1] * 1e-6
}
