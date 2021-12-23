(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global.createREGL = factory());
}(this, (function () { 'use strict';

var isTypedArray = function (x) {
  return (
    x instanceof Uint8Array ||
    x instanceof Uint16Array ||
    x instanceof Uint32Array ||
    x instanceof Int8Array ||
    x instanceof Int16Array ||
    x instanceof Int32Array ||
    x instanceof Float32Array ||
    x instanceof Float64Array ||
    x instanceof Uint8ClampedArray
  )
}

var extend = function (base, opts) {
  var keys = Object.keys(opts)
  for (var i = 0; i < keys.length; ++i) {
    base[keys[i]] = opts[keys[i]]
  }
  return base
}

// Error checking and parameter validation.
//
// Statements for the form `check.someProcedure(...)` get removed by
// a browserify transform for optimized/minified bundles.
//
/* globals atob */
var endl = '\n'

// only used for extracting shader names.  if atob not present, then errors
// will be slightly crappier
function decodeB64 (str) {
  if (typeof atob !== 'undefined') {
    return atob(str)
  }
  return 'base64:' + str
}

function raise (message) {
  var error = new Error('(regl) ' + message)
  console.error(error)
  throw error
}

function check (pred, message) {
  if (!pred) {
    raise(message)
  }
}

function encolon (message) {
  if (message) {
    return ': ' + message
  }
  return ''
}

function checkParameter (param, possibilities, message) {
  if (!(param in possibilities)) {
    raise('unknown parameter (' + param + ')' + encolon(message) +
          '. possible values: ' + Object.keys(possibilities).join())
  }
}

function checkIsTypedArray (data, message) {
  if (!isTypedArray(data)) {
    raise(
      'invalid parameter type' + encolon(message) +
      '. must be a typed array')
  }
}

function standardTypeEh (value, type) {
  switch (type) {
    case 'number': return typeof value === 'number'
    case 'object': return typeof value === 'object'
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'function': return typeof value === 'function'
    case 'undefined': return typeof value === 'undefined'
    case 'symbol': return typeof value === 'symbol'
  }
}

function checkTypeOf (value, type, message) {
  if (!standardTypeEh(value, type)) {
    raise(
      'invalid parameter type' + encolon(message) +
      '. expected ' + type + ', got ' + (typeof value))
  }
}

function checkNonNegativeInt (value, message) {
  if (!((value >= 0) &&
        ((value | 0) === value))) {
    raise('invalid parameter type, (' + value + ')' + encolon(message) +
          '. must be a nonnegative integer')
  }
}

function checkOneOf (value, list, message) {
  if (list.indexOf(value) < 0) {
    raise('invalid value' + encolon(message) + '. must be one of: ' + list)
  }
}

var constructorKeys = [
  'gl',
  'canvas',
  'container',
  'attributes',
  'pixelRatio',
  'extensions',
  'optionalExtensions',
  'profile',
  'onDone'
]

function checkConstructor (obj) {
  Object.keys(obj).forEach(function (key) {
    if (constructorKeys.indexOf(key) < 0) {
      raise('invalid regl constructor argument "' + key + '". must be one of ' + constructorKeys)
    }
  })
}

function leftPad (str, n) {
  str = str + ''
  while (str.length < n) {
    str = ' ' + str
  }
  return str
}

function ShaderFile () {
  this.name = 'unknown'
  this.lines = []
  this.index = {}
  this.hasErrors = false
}

function ShaderLine (number, line) {
  this.number = number
  this.line = line
  this.errors = []
}

function ShaderError (fileNumber, lineNumber, message) {
  this.file = fileNumber
  this.line = lineNumber
  this.message = message
}

function guessCommand () {
  var error = new Error()
  var stack = (error.stack || error).toString()
  var pat = /compileProcedure.*\n\s*at.*\((.*)\)/.exec(stack)
  if (pat) {
    return pat[1]
  }
  var pat2 = /compileProcedure.*\n\s*at\s+(.*)(\n|$)/.exec(stack)
  if (pat2) {
    return pat2[1]
  }
  return 'unknown'
}

function guessCallSite () {
  var error = new Error()
  var stack = (error.stack || error).toString()
  var pat = /at REGLCommand.*\n\s+at.*\((.*)\)/.exec(stack)
  if (pat) {
    return pat[1]
  }
  var pat2 = /at REGLCommand.*\n\s+at\s+(.*)\n/.exec(stack)
  if (pat2) {
    return pat2[1]
  }
  return 'unknown'
}

function parseSource (source, command) {
  var lines = source.split('\n')
  var lineNumber = 1
  var fileNumber = 0
  var files = {
    unknown: new ShaderFile(),
    0: new ShaderFile()
  }
  files.unknown.name = files[0].name = command || guessCommand()
  files.unknown.lines.push(new ShaderLine(0, ''))
  for (var i = 0; i < lines.length; ++i) {
    var line = lines[i]
    var parts = /^\s*#\s*(\w+)\s+(.+)\s*$/.exec(line)
    if (parts) {
      switch (parts[1]) {
        case 'line':
          var lineNumberInfo = /(\d+)(\s+\d+)?/.exec(parts[2])
          if (lineNumberInfo) {
            lineNumber = lineNumberInfo[1] | 0
            if (lineNumberInfo[2]) {
              fileNumber = lineNumberInfo[2] | 0
              if (!(fileNumber in files)) {
                files[fileNumber] = new ShaderFile()
              }
            }
          }
          break
        case 'define':
          var nameInfo = /SHADER_NAME(_B64)?\s+(.*)$/.exec(parts[2])
          if (nameInfo) {
            files[fileNumber].name = (nameInfo[1]
              ? decodeB64(nameInfo[2])
              : nameInfo[2])
          }
          break
      }
    }
    files[fileNumber].lines.push(new ShaderLine(lineNumber++, line))
  }
  Object.keys(files).forEach(function (fileNumber) {
    var file = files[fileNumber]
    file.lines.forEach(function (line) {
      file.index[line.number] = line
    })
  })
  return files
}

function parseErrorLog (errLog) {
  var result = []
  errLog.split('\n').forEach(function (errMsg) {
    if (errMsg.length < 5) {
      return
    }
    var parts = /^ERROR:\s+(\d+):(\d+):\s*(.*)$/.exec(errMsg)
    if (parts) {
      result.push(new ShaderError(
        parts[1] | 0,
        parts[2] | 0,
        parts[3].trim()))
    } else if (errMsg.length > 0) {
      result.push(new ShaderError('unknown', 0, errMsg))
    }
  })
  return result
}

function annotateFiles (files, errors) {
  errors.forEach(function (error) {
    var file = files[error.file]
    if (file) {
      var line = file.index[error.line]
      if (line) {
        line.errors.push(error)
        file.hasErrors = true
        return
      }
    }
    files.unknown.hasErrors = true
    files.unknown.lines[0].errors.push(error)
  })
}

function checkShaderError (gl, shader, source, type, command) {
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(shader)
    var typeName = type === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex'
    checkCommandType(source, 'string', typeName + ' shader source must be a string', command)
    var files = parseSource(source, command)
    var errors = parseErrorLog(errLog)
    annotateFiles(files, errors)

    Object.keys(files).forEach(function (fileNumber) {
      var file = files[fileNumber]
      if (!file.hasErrors) {
        return
      }

      var strings = ['']
      var styles = ['']

      function push (str, style) {
        strings.push(str)
        styles.push(style || '')
      }

      push('file number ' + fileNumber + ': ' + file.name + '\n', 'color:red;text-decoration:underline;font-weight:bold')

      file.lines.forEach(function (line) {
        if (line.errors.length > 0) {
          push(leftPad(line.number, 4) + '|  ', 'background-color:yellow; font-weight:bold')
          push(line.line + endl, 'color:red; background-color:yellow; font-weight:bold')

          // try to guess token
          var offset = 0
          line.errors.forEach(function (error) {
            var message = error.message
            var token = /^\s*'(.*)'\s*:\s*(.*)$/.exec(message)
            if (token) {
              var tokenPat = token[1]
              message = token[2]
              switch (tokenPat) {
                case 'assign':
                  tokenPat = '='
                  break
              }
              offset = Math.max(line.line.indexOf(tokenPat, offset), 0)
            } else {
              offset = 0
            }

            push(leftPad('| ', 6))
            push(leftPad('^^^', offset + 3) + endl, 'font-weight:bold')
            push(leftPad('| ', 6))
            push(message + endl, 'font-weight:bold')
          })
          push(leftPad('| ', 6) + endl)
        } else {
          push(leftPad(line.number, 4) + '|  ')
          push(line.line + endl, 'color:red')
        }
      })
      if (typeof document !== 'undefined' && !window.chrome) {
        styles[0] = strings.join('%c')
        console.log.apply(console, styles)
      } else {
        console.log(strings.join(''))
      }
    })

    check.raise('Error compiling ' + typeName + ' shader, ' + files[0].name)
  }
}

function checkLinkError (gl, program, fragShader, vertShader, command) {
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var errLog = gl.getProgramInfoLog(program)
    var fragParse = parseSource(fragShader, command)
    var vertParse = parseSource(vertShader, command)

    var header = 'Error linking program with vertex shader, "' +
      vertParse[0].name + '", and fragment shader "' + fragParse[0].name + '"'

    if (typeof document !== 'undefined') {
      console.log('%c' + header + endl + '%c' + errLog,
        'color:red;text-decoration:underline;font-weight:bold',
        'color:red')
    } else {
      console.log(header + endl + errLog)
    }
    check.raise(header)
  }
}

function saveCommandRef (object) {
  object._commandRef = guessCommand()
}

function saveDrawCommandInfo (opts, uniforms, attributes, stringStore) {
  saveCommandRef(opts)

  function id (str) {
    if (str) {
      return stringStore.id(str)
    }
    return 0
  }
  opts._fragId = id(opts.static.frag)
  opts._vertId = id(opts.static.vert)

  function addProps (dict, set) {
    Object.keys(set).forEach(function (u) {
      dict[stringStore.id(u)] = true
    })
  }

  var uniformSet = opts._uniformSet = {}
  addProps(uniformSet, uniforms.static)
  addProps(uniformSet, uniforms.dynamic)

  var attributeSet = opts._attributeSet = {}
  addProps(attributeSet, attributes.static)
  addProps(attributeSet, attributes.dynamic)

  opts._hasCount = (
    'count' in opts.static ||
    'count' in opts.dynamic ||
    'elements' in opts.static ||
    'elements' in opts.dynamic)
}

function commandRaise (message, command) {
  var callSite = guessCallSite()
  raise(message +
    ' in command ' + (command || guessCommand()) +
    (callSite === 'unknown' ? '' : ' called from ' + callSite))
}

function checkCommand (pred, message, command) {
  if (!pred) {
    commandRaise(message, command || guessCommand())
  }
}

function checkParameterCommand (param, possibilities, message, command) {
  if (!(param in possibilities)) {
    commandRaise(
      'unknown parameter (' + param + ')' + encolon(message) +
      '. possible values: ' + Object.keys(possibilities).join(),
      command || guessCommand())
  }
}

function checkCommandType (value, type, message, command) {
  if (!standardTypeEh(value, type)) {
    commandRaise(
      'invalid parameter type' + encolon(message) +
      '. expected ' + type + ', got ' + (typeof value),
      command || guessCommand())
  }
}

function checkOptional (block) {
  block()
}

function checkFramebufferFormat (attachment, texFormats, rbFormats) {
  if (attachment.texture) {
    checkOneOf(
      attachment.texture._texture.internalformat,
      texFormats,
      'unsupported texture format for attachment')
  } else {
    checkOneOf(
      attachment.renderbuffer._renderbuffer.format,
      rbFormats,
      'unsupported renderbuffer format for attachment')
  }
}

var GL_CLAMP_TO_EDGE = 0x812F

var GL_NEAREST = 0x2600
var GL_NEAREST_MIPMAP_NEAREST = 0x2700
var GL_LINEAR_MIPMAP_NEAREST = 0x2701
var GL_NEAREST_MIPMAP_LINEAR = 0x2702
var GL_LINEAR_MIPMAP_LINEAR = 0x2703

var GL_BYTE = 5120
var GL_UNSIGNED_BYTE = 5121
var GL_SHORT = 5122
var GL_UNSIGNED_SHORT = 5123
var GL_INT = 5124
var GL_UNSIGNED_INT = 5125
var GL_FLOAT = 5126

var GL_UNSIGNED_SHORT_4_4_4_4 = 0x8033
var GL_UNSIGNED_SHORT_5_5_5_1 = 0x8034
var GL_UNSIGNED_SHORT_5_6_5 = 0x8363
var GL_UNSIGNED_INT_24_8_WEBGL = 0x84FA

var GL_HALF_FLOAT_OES = 0x8D61

var TYPE_SIZE = {}

TYPE_SIZE[GL_BYTE] =
TYPE_SIZE[GL_UNSIGNED_BYTE] = 1

TYPE_SIZE[GL_SHORT] =
TYPE_SIZE[GL_UNSIGNED_SHORT] =
TYPE_SIZE[GL_HALF_FLOAT_OES] =
TYPE_SIZE[GL_UNSIGNED_SHORT_5_6_5] =
TYPE_SIZE[GL_UNSIGNED_SHORT_4_4_4_4] =
TYPE_SIZE[GL_UNSIGNED_SHORT_5_5_5_1] = 2

TYPE_SIZE[GL_INT] =
TYPE_SIZE[GL_UNSIGNED_INT] =
TYPE_SIZE[GL_FLOAT] =
TYPE_SIZE[GL_UNSIGNED_INT_24_8_WEBGL] = 4

function pixelSize (type, channels) {
  if (type === GL_UNSIGNED_SHORT_5_5_5_1 ||
      type === GL_UNSIGNED_SHORT_4_4_4_4 ||
      type === GL_UNSIGNED_SHORT_5_6_5) {
    return 2
  } else if (type === GL_UNSIGNED_INT_24_8_WEBGL) {
    return 4
  } else {
    return TYPE_SIZE[type] * channels
  }
}

function isPow2 (v) {
  return !(v & (v - 1)) && (!!v)
}

function checkTexture2D (info, mipData, limits) {
  var i
  var w = mipData.width
  var h = mipData.height
  var c = mipData.channels

  // Check texture shape
  check(w > 0 && w <= limits.maxTextureSize &&
        h > 0 && h <= limits.maxTextureSize,
  'invalid texture shape')

  // check wrap mode
  if (info.wrapS !== GL_CLAMP_TO_EDGE || info.wrapT !== GL_CLAMP_TO_EDGE) {
    check(isPow2(w) && isPow2(h),
      'incompatible wrap mode for texture, both width and height must be power of 2')
  }

  if (mipData.mipmask === 1) {
    if (w !== 1 && h !== 1) {
      check(
        info.minFilter !== GL_NEAREST_MIPMAP_NEAREST &&
        info.minFilter !== GL_NEAREST_MIPMAP_LINEAR &&
        info.minFilter !== GL_LINEAR_MIPMAP_NEAREST &&
        info.minFilter !== GL_LINEAR_MIPMAP_LINEAR,
        'min filter requires mipmap')
    }
  } else {
    // texture must be power of 2
    check(isPow2(w) && isPow2(h),
      'texture must be a square power of 2 to support mipmapping')
    check(mipData.mipmask === (w << 1) - 1,
      'missing or incomplete mipmap data')
  }

  if (mipData.type === GL_FLOAT) {
    if (limits.extensions.indexOf('oes_texture_float_linear') < 0) {
      check(info.minFilter === GL_NEAREST && info.magFilter === GL_NEAREST,
        'filter not supported, must enable oes_texture_float_linear')
    }
    check(!info.genMipmaps,
      'mipmap generation not supported with float textures')
  }

  // check image complete
  var mipimages = mipData.images
  for (i = 0; i < 16; ++i) {
    if (mipimages[i]) {
      var mw = w >> i
      var mh = h >> i
      check(mipData.mipmask & (1 << i), 'missing mipmap data')

      var img = mipimages[i]

      check(
        img.width === mw &&
        img.height === mh,
        'invalid shape for mip images')

      check(
        img.format === mipData.format &&
        img.internalformat === mipData.internalformat &&
        img.type === mipData.type,
        'incompatible type for mip image')

      if (img.compressed) {
        // TODO: check size for compressed images
      } else if (img.data) {
        // check(img.data.byteLength === mw * mh *
        // Math.max(pixelSize(img.type, c), img.unpackAlignment),
        var rowSize = Math.ceil(pixelSize(img.type, c) * mw / img.unpackAlignment) * img.unpackAlignment
        check(img.data.byteLength === rowSize * mh,
          'invalid data for image, buffer size is inconsistent with image format')
      } else if (img.element) {
        // TODO: check element can be loaded
      } else if (img.copy) {
        // TODO: check compatible format and type
      }
    } else if (!info.genMipmaps) {
      check((mipData.mipmask & (1 << i)) === 0, 'extra mipmap data')
    }
  }

  if (mipData.compressed) {
    check(!info.genMipmaps,
      'mipmap generation for compressed images not supported')
  }
}

function checkTextureCube (texture, info, faces, limits) {
  var w = texture.width
  var h = texture.height
  var c = texture.channels

  // Check texture shape
  check(
    w > 0 && w <= limits.maxTextureSize && h > 0 && h <= limits.maxTextureSize,
    'invalid texture shape')
  check(
    w === h,
    'cube map must be square')
  check(
    info.wrapS === GL_CLAMP_TO_EDGE && info.wrapT === GL_CLAMP_TO_EDGE,
    'wrap mode not supported by cube map')

  for (var i = 0; i < faces.length; ++i) {
    var face = faces[i]
    check(
      face.width === w && face.height === h,
      'inconsistent cube map face shape')

    if (info.genMipmaps) {
      check(!face.compressed,
        'can not generate mipmap for compressed textures')
      check(face.mipmask === 1,
        'can not specify mipmaps and generate mipmaps')
    } else {
      // TODO: check mip and filter mode
    }

    var mipmaps = face.images
    for (var j = 0; j < 16; ++j) {
      var img = mipmaps[j]
      if (img) {
        var mw = w >> j
        var mh = h >> j
        check(face.mipmask & (1 << j), 'missing mipmap data')
        check(
          img.width === mw &&
          img.height === mh,
          'invalid shape for mip images')
        check(
          img.format === texture.format &&
          img.internalformat === texture.internalformat &&
          img.type === texture.type,
          'incompatible type for mip image')

        if (img.compressed) {
          // TODO: check size for compressed images
        } else if (img.data) {
          check(img.data.byteLength === mw * mh *
            Math.max(pixelSize(img.type, c), img.unpackAlignment),
          'invalid data for image, buffer size is inconsistent with image format')
        } else if (img.element) {
          // TODO: check element can be loaded
        } else if (img.copy) {
          // TODO: check compatible format and type
        }
      }
    }
  }
}

var check$1 = extend(check, {
  optional: checkOptional,
  raise: raise,
  commandRaise: commandRaise,
  command: checkCommand,
  parameter: checkParameter,
  commandParameter: checkParameterCommand,
  constructor: checkConstructor,
  type: checkTypeOf,
  commandType: checkCommandType,
  isTypedArray: checkIsTypedArray,
  nni: checkNonNegativeInt,
  oneOf: checkOneOf,
  shaderError: checkShaderError,
  linkError: checkLinkError,
  callSite: guessCallSite,
  saveCommandRef: saveCommandRef,
  saveDrawInfo: saveDrawCommandInfo,
  framebufferFormat: checkFramebufferFormat,
  guessCommand: guessCommand,
  texture2D: checkTexture2D,
  textureCube: checkTextureCube
});

var VARIABLE_COUNTER = 0

var DYN_FUNC = 0
var DYN_CONSTANT = 5
var DYN_ARRAY = 6

function DynamicVariable (type, data) {
  this.id = (VARIABLE_COUNTER++)
  this.type = type
  this.data = data
}

function escapeStr (str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function splitParts (str) {
  if (str.length === 0) {
    return []
  }

  var firstChar = str.charAt(0)
  var lastChar = str.charAt(str.length - 1)

  if (str.length > 1 &&
      firstChar === lastChar &&
      (firstChar === '"' || firstChar === "'")) {
    return ['"' + escapeStr(str.substr(1, str.length - 2)) + '"']
  }

  var parts = /\[(false|true|null|\d+|'[^']*'|"[^"]*")\]/.exec(str)
  if (parts) {
    return (
      splitParts(str.substr(0, parts.index))
        .concat(splitParts(parts[1]))
        .concat(splitParts(str.substr(parts.index + parts[0].length)))
    )
  }

  var subparts = str.split('.')
  if (subparts.length === 1) {
    return ['"' + escapeStr(str) + '"']
  }

  var result = []
  for (var i = 0; i < subparts.length; ++i) {
    result = result.concat(splitParts(subparts[i]))
  }
  return result
}

function toAccessorString (str) {
  return '[' + splitParts(str).join('][') + ']'
}

function defineDynamic (type, data) {
  return new DynamicVariable(type, toAccessorString(data + ''))
}

function isDynamic (x) {
  return (typeof x === 'function' && !x._reglType) || (x instanceof DynamicVariable)
}

function unbox (x, path) {
  if (typeof x === 'function') {
    return new DynamicVariable(DYN_FUNC, x)
  } else if (typeof x === 'number' || typeof x === 'boolean') {
    return new DynamicVariable(DYN_CONSTANT, x)
  } else if (Array.isArray(x)) {
    return new DynamicVariable(DYN_ARRAY, x.map(function (y, i) { return unbox(y, path + '[' + i + ']') }))
  } else if (x instanceof DynamicVariable) {
    return x
  }
  check$1(false, 'invalid option type in uniform ' + path)
}

var dynamic = {
  DynamicVariable: DynamicVariable,
  define: defineDynamic,
  isDynamic: isDynamic,
  unbox: unbox,
  accessor: toAccessorString
};

/* globals requestAnimationFrame, cancelAnimationFrame */
var raf = {
  next: typeof requestAnimationFrame === 'function'
    ? function (cb) { return requestAnimationFrame(cb) }
    : function (cb) { return setTimeout(cb, 16) },
  cancel: typeof cancelAnimationFrame === 'function'
    ? function (raf) { return cancelAnimationFrame(raf) }
    : clearTimeout
};

/* globals performance */
var clock = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now() }
    : function () { return +(new Date()) };

function createStringStore () {
  var stringIds = { '': 0 }
  var stringValues = ['']
  return {
    id: function (str) {
      var result = stringIds[str]
      if (result) {
        return result
      }
      result = stringIds[str] = stringValues.length
      stringValues.push(str)
      return result
    },

    str: function (id) {
      return stringValues[id]
    }
  }
}

// Context and canvas creation helper functions
function createCanvas (element, onDone, pixelRatio) {
  var canvas = document.createElement('canvas')
  extend(canvas.style, {
    border: 0,
    margin: 0,
    padding: 0,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  })
  element.appendChild(canvas)

  if (element === document.body) {
    canvas.style.position = 'absolute'
    extend(element.style, {
      margin: 0,
      padding: 0
    })
  }

  function resize () {
    var w = window.innerWidth
    var h = window.innerHeight
    if (element !== document.body) {
      var bounds = canvas.getBoundingClientRect()
      w = bounds.right - bounds.left
      h = bounds.bottom - bounds.top
    }
    canvas.width = pixelRatio * w
    canvas.height = pixelRatio * h
  }

  var resizeObserver
  if (element !== document.body && typeof ResizeObserver === 'function') {
    // ignore 'ResizeObserver' is not defined
    // eslint-disable-next-line
    resizeObserver = new ResizeObserver(function () {
      // setTimeout to avoid flicker
      setTimeout(resize)
    })
    resizeObserver.observe(element)
  } else {
    window.addEventListener('resize', resize, false)
  }

  function onDestroy () {
    if (resizeObserver) {
      resizeObserver.disconnect()
    } else {
      window.removeEventListener('resize', resize)
    }
    element.removeChild(canvas)
  }

  resize()

  return {
    canvas: canvas,
    onDestroy: onDestroy
  }
}

function createContext (canvas, contextAttributes) {
  function get (name) {
    try {
      return canvas.getContext(name, contextAttributes)
    } catch (e) {
      return null
    }
  }
  return (
    get('webgl') ||
    get('experimental-webgl') ||
    get('webgl-experimental')
  )
}

function isHTMLElement (obj) {
  return (
    typeof obj.nodeName === 'string' &&
    typeof obj.appendChild === 'function' &&
    typeof obj.getBoundingClientRect === 'function'
  )
}

function isWebGLContext (obj) {
  return (
    typeof obj.drawArrays === 'function' ||
    typeof obj.drawElements === 'function'
  )
}

function parseExtensions (input) {
  if (typeof input === 'string') {
    return input.split()
  }
  check$1(Array.isArray(input), 'invalid extension array')
  return input
}

function getElement (desc) {
  if (typeof desc === 'string') {
    check$1(typeof document !== 'undefined', 'not supported outside of DOM')
    return document.querySelector(desc)
  }
  return desc
}

function parseArgs (args_) {
  var args = args_ || {}
  var element, container, canvas, gl
  var contextAttributes = {}
  var extensions = []
  var optionalExtensions = []
  var pixelRatio = (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
  var profile = false
  var onDone = function (err) {
    if (err) {
      check$1.raise(err)
    }
  }
  var onDestroy = function () {}
  if (typeof args === 'string') {
    check$1(
      typeof document !== 'undefined',
      'selector queries only supported in DOM environments')
    element = document.querySelector(args)
    check$1(element, 'invalid query string for element')
  } else if (typeof args === 'object') {
    if (isHTMLElement(args)) {
      element = args
    } else if (isWebGLContext(args)) {
      gl = args
      canvas = gl.canvas
    } else {
      check$1.constructor(args)
      if ('gl' in args) {
        gl = args.gl
      } else if ('canvas' in args) {
        canvas = getElement(args.canvas)
      } else if ('container' in args) {
        container = getElement(args.container)
      }
      if ('attributes' in args) {
        contextAttributes = args.attributes
        check$1.type(contextAttributes, 'object', 'invalid context attributes')
      }
      if ('extensions' in args) {
        extensions = parseExtensions(args.extensions)
      }
      if ('optionalExtensions' in args) {
        optionalExtensions = parseExtensions(args.optionalExtensions)
      }
      if ('onDone' in args) {
        check$1.type(
          args.onDone, 'function',
          'invalid or missing onDone callback')
        onDone = args.onDone
      }
      if ('profile' in args) {
        profile = !!args.profile
      }
      if ('pixelRatio' in args) {
        pixelRatio = +args.pixelRatio
        check$1(pixelRatio > 0, 'invalid pixel ratio')
      }
    }
  } else {
    check$1.raise('invalid arguments to regl')
  }

  if (element) {
    if (element.nodeName.toLowerCase() === 'canvas') {
      canvas = element
    } else {
      container = element
    }
  }

  if (!gl) {
    if (!canvas) {
      check$1(
        typeof document !== 'undefined',
        'must manually specify webgl context outside of DOM environments')
      var result = createCanvas(container || document.body, onDone, pixelRatio)
      if (!result) {
        return null
      }
      canvas = result.canvas
      onDestroy = result.onDestroy
    }
    // workaround for chromium bug, premultiplied alpha value is platform dependent
    if (contextAttributes.premultipliedAlpha === undefined) contextAttributes.premultipliedAlpha = true
    gl = createContext(canvas, contextAttributes)
  }

  if (!gl) {
    onDestroy()
    onDone('webgl not supported, try upgrading your browser or graphics drivers http://get.webgl.org')
    return null
  }

  return {
    gl: gl,
    canvas: canvas,
    container: container,
    extensions: extensions,
    optionalExtensions: optionalExtensions,
    pixelRatio: pixelRatio,
    profile: profile,
    onDone: onDone,
    onDestroy: onDestroy
  }
}

function createExtensionCache (gl, config) {
  var extensions = {}

  function tryLoadExtension (name_) {
    check$1.type(name_, 'string', 'extension name must be string')
    var name = name_.toLowerCase()
    var ext
    try {
      ext = extensions[name] = gl.getExtension(name)
    } catch (e) {}
    return !!ext
  }

  for (var i = 0; i < config.extensions.length; ++i) {
    var name = config.extensions[i]
    if (!tryLoadExtension(name)) {
      config.onDestroy()
      config.onDone('"' + name + '" extension is not supported by the current WebGL context, try upgrading your system or a different browser')
      return null
    }
  }

  config.optionalExtensions.forEach(tryLoadExtension)

  return {
    extensions: extensions,
    restore: function () {
      Object.keys(extensions).forEach(function (name) {
        if (extensions[name] && !tryLoadExtension(name)) {
          throw new Error('(regl): error restoring extension ' + name)
        }
      })
    }
  }
}

function loop (n, f) {
  var result = Array(n)
  for (var i = 0; i < n; ++i) {
    result[i] = f(i)
  }
  return result
}

var GL_BYTE$1 = 5120
var GL_UNSIGNED_BYTE$2 = 5121
var GL_SHORT$1 = 5122
var GL_UNSIGNED_SHORT$1 = 5123
var GL_INT$1 = 5124
var GL_UNSIGNED_INT$1 = 5125
var GL_FLOAT$2 = 5126

function nextPow16 (v) {
  for (var i = 16; i <= (1 << 28); i *= 16) {
    if (v <= i) {
      return i
    }
  }
  return 0
}

function log2 (v) {
  var r, shift
  r = (v > 0xFFFF) << 4
  v >>>= r
  shift = (v > 0xFF) << 3
  v >>>= shift; r |= shift
  shift = (v > 0xF) << 2
  v >>>= shift; r |= shift
  shift = (v > 0x3) << 1
  v >>>= shift; r |= shift
  return r | (v >> 1)
}

function createPool () {
  var bufferPool = loop(8, function () {
    return []
  })

  function alloc (n) {
    var sz = nextPow16(n)
    var bin = bufferPool[log2(sz) >> 2]
    if (bin.length > 0) {
      return bin.pop()
    }
    return new ArrayBuffer(sz)
  }

  function free (buf) {
    bufferPool[log2(buf.byteLength) >> 2].push(buf)
  }

  function allocType (type, n) {
    var result = null
    switch (type) {
      case GL_BYTE$1:
        result = new Int8Array(alloc(n), 0, n)
        break
      case GL_UNSIGNED_BYTE$2:
        result = new Uint8Array(alloc(n), 0, n)
        break
      case GL_SHORT$1:
        result = new Int16Array(alloc(2 * n), 0, n)
        break
      case GL_UNSIGNED_SHORT$1:
        result = new Uint16Array(alloc(2 * n), 0, n)
        break
      case GL_INT$1:
        result = new Int32Array(alloc(4 * n), 0, n)
        break
      case GL_UNSIGNED_INT$1:
        result = new Uint32Array(alloc(4 * n), 0, n)
        break
      case GL_FLOAT$2:
        result = new Float32Array(alloc(4 * n), 0, n)
        break
      default:
        return null
    }
    if (result.length !== n) {
      return result.subarray(0, n)
    }
    return result
  }

  function freeType (array) {
    free(array.buffer)
  }

  return {
    alloc: alloc,
    free: free,
    allocType: allocType,
    freeType: freeType
  }
}

var pool = createPool()

// zero pool for initial zero data
pool.zero = createPool()

var GL_SUBPIXEL_BITS = 0x0D50
var GL_RED_BITS = 0x0D52
var GL_GREEN_BITS = 0x0D53
var GL_BLUE_BITS = 0x0D54
var GL_ALPHA_BITS = 0x0D55
var GL_DEPTH_BITS = 0x0D56
var GL_STENCIL_BITS = 0x0D57

var GL_ALIASED_POINT_SIZE_RANGE = 0x846D
var GL_ALIASED_LINE_WIDTH_RANGE = 0x846E

var GL_MAX_TEXTURE_SIZE = 0x0D33
var GL_MAX_VIEWPORT_DIMS = 0x0D3A
var GL_MAX_VERTEX_ATTRIBS = 0x8869
var GL_MAX_VERTEX_UNIFORM_VECTORS = 0x8DFB
var GL_MAX_VARYING_VECTORS = 0x8DFC
var GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0x8B4D
var GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS = 0x8B4C
var GL_MAX_TEXTURE_IMAGE_UNITS = 0x8872
var GL_MAX_FRAGMENT_UNIFORM_VECTORS = 0x8DFD
var GL_MAX_CUBE_MAP_TEXTURE_SIZE = 0x851C
var GL_MAX_RENDERBUFFER_SIZE = 0x84E8

var GL_VENDOR = 0x1F00
var GL_RENDERER = 0x1F01
var GL_VERSION = 0x1F02
var GL_SHADING_LANGUAGE_VERSION = 0x8B8C

var GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF

var GL_MAX_COLOR_ATTACHMENTS_WEBGL = 0x8CDF
var GL_MAX_DRAW_BUFFERS_WEBGL = 0x8824

var GL_TEXTURE_2D = 0x0DE1
var GL_TEXTURE_CUBE_MAP = 0x8513
var GL_TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515
var GL_TEXTURE0 = 0x84C0
var GL_RGBA = 0x1908
var GL_FLOAT$1 = 0x1406
var GL_UNSIGNED_BYTE$1 = 0x1401
var GL_FRAMEBUFFER = 0x8D40
var GL_FRAMEBUFFER_COMPLETE = 0x8CD5
var GL_COLOR_ATTACHMENT0 = 0x8CE0
var GL_COLOR_BUFFER_BIT$1 = 0x4000

var wrapLimits = function (gl, extensions) {
  var maxAnisotropic = 1
  if (extensions.ext_texture_filter_anisotropic) {
    maxAnisotropic = gl.getParameter(GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT)
  }

  var maxDrawbuffers = 1
  var maxColorAttachments = 1
  if (extensions.webgl_draw_buffers) {
    maxDrawbuffers = gl.getParameter(GL_MAX_DRAW_BUFFERS_WEBGL)
    maxColorAttachments = gl.getParameter(GL_MAX_COLOR_ATTACHMENTS_WEBGL)
  }

  // detect if reading float textures is available (Safari doesn't support)
  var readFloat = !!extensions.oes_texture_float
  if (readFloat) {
    var readFloatTexture = gl.createTexture()
    gl.bindTexture(GL_TEXTURE_2D, readFloatTexture)
    gl.texImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_FLOAT$1, null)

    var fbo = gl.createFramebuffer()
    gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, readFloatTexture, 0)
    gl.bindTexture(GL_TEXTURE_2D, null)

    if (gl.checkFramebufferStatus(GL_FRAMEBUFFER) !== GL_FRAMEBUFFER_COMPLETE) readFloat = false

    else {
      gl.viewport(0, 0, 1, 1)
      gl.clearColor(1.0, 0.0, 0.0, 1.0)
      gl.clear(GL_COLOR_BUFFER_BIT$1)
      var pixels = pool.allocType(GL_FLOAT$1, 4)
      gl.readPixels(0, 0, 1, 1, GL_RGBA, GL_FLOAT$1, pixels)

      if (gl.getError()) readFloat = false
      else {
        gl.deleteFramebuffer(fbo)
        gl.deleteTexture(readFloatTexture)

        readFloat = pixels[0] === 1.0
      }

      pool.freeType(pixels)
    }
  }

  // detect non power of two cube textures support (IE doesn't support)
  var isIE = typeof navigator !== 'undefined' && (/MSIE/.test(navigator.userAgent) || /Trident\//.test(navigator.appVersion) || /Edge/.test(navigator.userAgent))

  var npotTextureCube = true

  if (!isIE) {
    var cubeTexture = gl.createTexture()
    var data = pool.allocType(GL_UNSIGNED_BYTE$1, 36)
    gl.activeTexture(GL_TEXTURE0)
    gl.bindTexture(GL_TEXTURE_CUBE_MAP, cubeTexture)
    gl.texImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X, 0, GL_RGBA, 3, 3, 0, GL_RGBA, GL_UNSIGNED_BYTE$1, data)
    pool.freeType(data)
    gl.bindTexture(GL_TEXTURE_CUBE_MAP, null)
    gl.deleteTexture(cubeTexture)
    npotTextureCube = !gl.getError()
  }

  return {
    // drawing buffer bit depth
    colorBits: [
      gl.getParameter(GL_RED_BITS),
      gl.getParameter(GL_GREEN_BITS),
      gl.getParameter(GL_BLUE_BITS),
      gl.getParameter(GL_ALPHA_BITS)
    ],
    depthBits: gl.getParameter(GL_DEPTH_BITS),
    stencilBits: gl.getParameter(GL_STENCIL_BITS),
    subpixelBits: gl.getParameter(GL_SUBPIXEL_BITS),

    // supported extensions
    extensions: Object.keys(extensions).filter(function (ext) {
      return !!extensions[ext]
    }),

    // max aniso samples
    maxAnisotropic: maxAnisotropic,

    // max draw buffers
    maxDrawbuffers: maxDrawbuffers,
    maxColorAttachments: maxColorAttachments,

    // point and line size ranges
    pointSizeDims: gl.getParameter(GL_ALIASED_POINT_SIZE_RANGE),
    lineWidthDims: gl.getParameter(GL_ALIASED_LINE_WIDTH_RANGE),
    maxViewportDims: gl.getParameter(GL_MAX_VIEWPORT_DIMS),
    maxCombinedTextureUnits: gl.getParameter(GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    maxCubeMapSize: gl.getParameter(GL_MAX_CUBE_MAP_TEXTURE_SIZE),
    maxRenderbufferSize: gl.getParameter(GL_MAX_RENDERBUFFER_SIZE),
    maxTextureUnits: gl.getParameter(GL_MAX_TEXTURE_IMAGE_UNITS),
    maxTextureSize: gl.getParameter(GL_MAX_TEXTURE_SIZE),
    maxAttributes: gl.getParameter(GL_MAX_VERTEX_ATTRIBS),
    maxVertexUniforms: gl.getParameter(GL_MAX_VERTEX_UNIFORM_VECTORS),
    maxVertexTextureUnits: gl.getParameter(GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    maxVaryingVectors: gl.getParameter(GL_MAX_VARYING_VECTORS),
    maxFragmentUniforms: gl.getParameter(GL_MAX_FRAGMENT_UNIFORM_VECTORS),

    // vendor info
    glsl: gl.getParameter(GL_SHADING_LANGUAGE_VERSION),
    renderer: gl.getParameter(GL_RENDERER),
    vendor: gl.getParameter(GL_VENDOR),
    version: gl.getParameter(GL_VERSION),

    // quirks
    readFloat: readFloat,
    npotTextureCube: npotTextureCube
  }
}

function isNDArrayLike (obj) {
  return (
    !!obj &&
    typeof obj === 'object' &&
    Array.isArray(obj.shape) &&
    Array.isArray(obj.stride) &&
    typeof obj.offset === 'number' &&
    obj.shape.length === obj.stride.length &&
    (Array.isArray(obj.data) ||
      isTypedArray(obj.data)))
}

var values = function (obj) {
  return Object.keys(obj).map(function (key) { return obj[key] })
}

var flattenUtils = {
  shape: arrayShape$1,
  flatten: flattenArray
};

function flatten1D (array, nx, out) {
  for (var i = 0; i < nx; ++i) {
    out[i] = array[i]
  }
}

function flatten2D (array, nx, ny, out) {
  var ptr = 0
  for (var i = 0; i < nx; ++i) {
    var row = array[i]
    for (var j = 0; j < ny; ++j) {
      out[ptr++] = row[j]
    }
  }
}

function flatten3D (array, nx, ny, nz, out, ptr_) {
  var ptr = ptr_
  for (var i = 0; i < nx; ++i) {
    var row = array[i]
    for (var j = 0; j < ny; ++j) {
      var col = row[j]
      for (var k = 0; k < nz; ++k) {
        out[ptr++] = col[k]
      }
    }
  }
}

function flattenRec (array, shape, level, out, ptr) {
  var stride = 1
  for (var i = level + 1; i < shape.length; ++i) {
    stride *= shape[i]
  }
  var n = shape[level]
  if (shape.length - level === 4) {
    var nx = shape[level + 1]
    var ny = shape[level + 2]
    var nz = shape[level + 3]
    for (i = 0; i < n; ++i) {
      flatten3D(array[i], nx, ny, nz, out, ptr)
      ptr += stride
    }
  } else {
    for (i = 0; i < n; ++i) {
      flattenRec(array[i], shape, level + 1, out, ptr)
      ptr += stride
    }
  }
}

function flattenArray (array, shape, type, out_) {
  var sz = 1
  if (shape.length) {
    for (var i = 0; i < shape.length; ++i) {
      sz *= shape[i]
    }
  } else {
    sz = 0
  }
  var out = out_ || pool.allocType(type, sz)
  switch (shape.length) {
    case 0:
      break
    case 1:
      flatten1D(array, shape[0], out)
      break
    case 2:
      flatten2D(array, shape[0], shape[1], out)
      break
    case 3:
      flatten3D(array, shape[0], shape[1], shape[2], out, 0)
      break
    default:
      flattenRec(array, shape, 0, out, 0)
  }
  return out
}

function arrayShape$1 (array_) {
  var shape = []
  for (var array = array_; array.length; array = array[0]) {
    shape.push(array.length)
  }
  return shape
}

var arrayTypes =  {
	"[object Int8Array]": 5120,
	"[object Int16Array]": 5122,
	"[object Int32Array]": 5124,
	"[object Uint8Array]": 5121,
	"[object Uint8ClampedArray]": 5121,
	"[object Uint16Array]": 5123,
	"[object Uint32Array]": 5125,
	"[object Float32Array]": 5126,
	"[object Float64Array]": 5121,
	"[object ArrayBuffer]": 5121
};

var int8 = 5120;
var int16 = 5122;
var int32 = 5124;
var uint8 = 5121;
var uint16 = 5123;
var uint32 = 5125;
var float = 5126;
var float32 = 5126;
var glTypes = {
	int8: int8,
	int16: int16,
	int32: int32,
	uint8: uint8,
	uint16: uint16,
	uint32: uint32,
	float: float,
	float32: float32
};

var dynamic$1 = 35048;
var stream = 35040;
var usageTypes = {
	dynamic: dynamic$1,
	stream: stream,
	"static": 35044
};

var arrayFlatten = flattenUtils.flatten
var arrayShape = flattenUtils.shape

var GL_STATIC_DRAW = 0x88E4
var GL_STREAM_DRAW = 0x88E0

var GL_UNSIGNED_BYTE$3 = 5121
var GL_FLOAT$3 = 5126

var DTYPES_SIZES = []
DTYPES_SIZES[5120] = 1 // int8
DTYPES_SIZES[5122] = 2 // int16
DTYPES_SIZES[5124] = 4 // int32
DTYPES_SIZES[5121] = 1 // uint8
DTYPES_SIZES[5123] = 2 // uint16
DTYPES_SIZES[5125] = 4 // uint32
DTYPES_SIZES[5126] = 4 // float32

function typedArrayCode (data) {
  return arrayTypes[Object.prototype.toString.call(data)] | 0
}

function copyArray (out, inp) {
  for (var i = 0; i < inp.length; ++i) {
    out[i] = inp[i]
  }
}

function transpose (
  result, data, shapeX, shapeY, strideX, strideY, offset) {
  var ptr = 0
  for (var i = 0; i < shapeX; ++i) {
    for (var j = 0; j < shapeY; ++j) {
      result[ptr++] = data[strideX * i + strideY * j + offset]
    }
  }
}

function wrapBufferState (gl, stats, config, destroyBuffer) {
  var bufferCount = 0
  var bufferSet = {}

  function REGLBuffer (type) {
    this.id = bufferCount++
    this.buffer = gl.createBuffer()
    this.type = type
    this.usage = GL_STATIC_DRAW
    this.byteLength = 0
    this.dimension = 1
    this.dtype = GL_UNSIGNED_BYTE$3

    this.persistentData = null

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  REGLBuffer.prototype.bind = function () {
    gl.bindBuffer(this.type, this.buffer)
  }

  REGLBuffer.prototype.destroy = function () {
    destroy(this)
  }

  var streamPool = []

  function createStream (type, data) {
    var buffer = streamPool.pop()
    if (!buffer) {
      buffer = new REGLBuffer(type)
    }
    buffer.bind()
    initBufferFromData(buffer, data, GL_STREAM_DRAW, 0, 1, false)
    return buffer
  }

  function destroyStream (stream$$1) {
    streamPool.push(stream$$1)
  }

  function initBufferFromTypedArray (buffer, data, usage) {
    buffer.byteLength = data.byteLength
    gl.bufferData(buffer.type, data, usage)
  }

  function initBufferFromData (buffer, data, usage, dtype, dimension, persist) {
    var shape
    buffer.usage = usage
    if (Array.isArray(data)) {
      buffer.dtype = dtype || GL_FLOAT$3
      if (data.length > 0) {
        var flatData
        if (Array.isArray(data[0])) {
          shape = arrayShape(data)
          var dim = 1
          for (var i = 1; i < shape.length; ++i) {
            dim *= shape[i]
          }
          buffer.dimension = dim
          flatData = arrayFlatten(data, shape, buffer.dtype)
          initBufferFromTypedArray(buffer, flatData, usage)
          if (persist) {
            buffer.persistentData = flatData
          } else {
            pool.freeType(flatData)
          }
        } else if (typeof data[0] === 'number') {
          buffer.dimension = dimension
          var typedData = pool.allocType(buffer.dtype, data.length)
          copyArray(typedData, data)
          initBufferFromTypedArray(buffer, typedData, usage)
          if (persist) {
            buffer.persistentData = typedData
          } else {
            pool.freeType(typedData)
          }
        } else if (isTypedArray(data[0])) {
          buffer.dimension = data[0].length
          buffer.dtype = dtype || typedArrayCode(data[0]) || GL_FLOAT$3
          flatData = arrayFlatten(
            data,
            [data.length, data[0].length],
            buffer.dtype)
          initBufferFromTypedArray(buffer, flatData, usage)
          if (persist) {
            buffer.persistentData = flatData
          } else {
            pool.freeType(flatData)
          }
        } else {
          check$1.raise('invalid buffer data')
        }
      }
    } else if (isTypedArray(data)) {
      buffer.dtype = dtype || typedArrayCode(data)
      buffer.dimension = dimension
      initBufferFromTypedArray(buffer, data, usage)
      if (persist) {
        buffer.persistentData = new Uint8Array(new Uint8Array(data.buffer))
      }
    } else if (isNDArrayLike(data)) {
      shape = data.shape
      var stride = data.stride
      var offset = data.offset

      var shapeX = 0
      var shapeY = 0
      var strideX = 0
      var strideY = 0
      if (shape.length === 1) {
        shapeX = shape[0]
        shapeY = 1
        strideX = stride[0]
        strideY = 0
      } else if (shape.length === 2) {
        shapeX = shape[0]
        shapeY = shape[1]
        strideX = stride[0]
        strideY = stride[1]
      } else {
        check$1.raise('invalid shape')
      }

      buffer.dtype = dtype || typedArrayCode(data.data) || GL_FLOAT$3
      buffer.dimension = shapeY

      var transposeData = pool.allocType(buffer.dtype, shapeX * shapeY)
      transpose(transposeData,
        data.data,
        shapeX, shapeY,
        strideX, strideY,
        offset)
      initBufferFromTypedArray(buffer, transposeData, usage)
      if (persist) {
        buffer.persistentData = transposeData
      } else {
        pool.freeType(transposeData)
      }
    } else if (data instanceof ArrayBuffer) {
      buffer.dtype = GL_UNSIGNED_BYTE$3
      buffer.dimension = dimension
      initBufferFromTypedArray(buffer, data, usage)
      if (persist) {
        buffer.persistentData = new Uint8Array(new Uint8Array(data))
      }
    } else {
      check$1.raise('invalid buffer data')
    }
  }

  function destroy (buffer) {
    stats.bufferCount--

    // remove attribute link
    destroyBuffer(buffer)

    var handle = buffer.buffer
    check$1(handle, 'buffer must not be deleted already')
    gl.deleteBuffer(handle)
    buffer.buffer = null
    delete bufferSet[buffer.id]
  }

  function createBuffer (options, type, deferInit, persistent) {
    stats.bufferCount++

    var buffer = new REGLBuffer(type)
    bufferSet[buffer.id] = buffer

    function reglBuffer (options) {
      var usage = GL_STATIC_DRAW
      var data = null
      var byteLength = 0
      var dtype = 0
      var dimension = 1
      if (Array.isArray(options) ||
          isTypedArray(options) ||
          isNDArrayLike(options) ||
          options instanceof ArrayBuffer) {
        data = options
      } else if (typeof options === 'number') {
        byteLength = options | 0
      } else if (options) {
        check$1.type(
          options, 'object',
          'buffer arguments must be an object, a number or an array')

        if ('data' in options) {
          check$1(
            data === null ||
            Array.isArray(data) ||
            isTypedArray(data) ||
            isNDArrayLike(data),
            'invalid data for buffer')
          data = options.data
        }

        if ('usage' in options) {
          check$1.parameter(options.usage, usageTypes, 'invalid buffer usage')
          usage = usageTypes[options.usage]
        }

        if ('type' in options) {
          check$1.parameter(options.type, glTypes, 'invalid buffer type')
          dtype = glTypes[options.type]
        }

        if ('dimension' in options) {
          check$1.type(options.dimension, 'number', 'invalid dimension')
          dimension = options.dimension | 0
        }

        if ('length' in options) {
          check$1.nni(byteLength, 'buffer length must be a nonnegative integer')
          byteLength = options.length | 0
        }
      }

      buffer.bind()
      if (!data) {
        // #475
        if (byteLength) gl.bufferData(buffer.type, byteLength, usage)
        buffer.dtype = dtype || GL_UNSIGNED_BYTE$3
        buffer.usage = usage
        buffer.dimension = dimension
        buffer.byteLength = byteLength
      } else {
        initBufferFromData(buffer, data, usage, dtype, dimension, persistent)
      }

      if (config.profile) {
        buffer.stats.size = buffer.byteLength * DTYPES_SIZES[buffer.dtype]
      }

      return reglBuffer
    }

    function setSubData (data, offset) {
      check$1(offset + data.byteLength <= buffer.byteLength,
        'invalid buffer subdata call, buffer is too small. ' + ' Can\'t write data of size ' + data.byteLength + ' starting from offset ' + offset + ' to a buffer of size ' + buffer.byteLength)

      gl.bufferSubData(buffer.type, offset, data)
    }

    function subdata (data, offset_) {
      var offset = (offset_ || 0) | 0
      var shape
      buffer.bind()
      if (isTypedArray(data) || data instanceof ArrayBuffer) {
        setSubData(data, offset)
      } else if (Array.isArray(data)) {
        if (data.length > 0) {
          if (typeof data[0] === 'number') {
            var converted = pool.allocType(buffer.dtype, data.length)
            copyArray(converted, data)
            setSubData(converted, offset)
            pool.freeType(converted)
          } else if (Array.isArray(data[0]) || isTypedArray(data[0])) {
            shape = arrayShape(data)
            var flatData = arrayFlatten(data, shape, buffer.dtype)
            setSubData(flatData, offset)
            pool.freeType(flatData)
          } else {
            check$1.raise('invalid buffer data')
          }
        }
      } else if (isNDArrayLike(data)) {
        shape = data.shape
        var stride = data.stride

        var shapeX = 0
        var shapeY = 0
        var strideX = 0
        var strideY = 0
        if (shape.length === 1) {
          shapeX = shape[0]
          shapeY = 1
          strideX = stride[0]
          strideY = 0
        } else if (shape.length === 2) {
          shapeX = shape[0]
          shapeY = shape[1]
          strideX = stride[0]
          strideY = stride[1]
        } else {
          check$1.raise('invalid shape')
        }
        var dtype = Array.isArray(data.data)
          ? buffer.dtype
          : typedArrayCode(data.data)

        var transposeData = pool.allocType(dtype, shapeX * shapeY)
        transpose(transposeData,
          data.data,
          shapeX, shapeY,
          strideX, strideY,
          data.offset)
        setSubData(transposeData, offset)
        pool.freeType(transposeData)
      } else {
        check$1.raise('invalid data for buffer subdata')
      }
      return reglBuffer
    }

    if (!deferInit) {
      reglBuffer(options)
    }

    reglBuffer._reglType = 'buffer'
    reglBuffer._buffer = buffer
    reglBuffer.subdata = subdata
    if (config.profile) {
      reglBuffer.stats = buffer.stats
    }
    reglBuffer.destroy = function () { destroy(buffer) }

    return reglBuffer
  }

  function restoreBuffers () {
    values(bufferSet).forEach(function (buffer) {
      buffer.buffer = gl.createBuffer()
      gl.bindBuffer(buffer.type, buffer.buffer)
      gl.bufferData(
        buffer.type, buffer.persistentData || buffer.byteLength, buffer.usage)
    })
  }

  if (config.profile) {
    stats.getTotalBufferSize = function () {
      var total = 0
      // TODO: Right now, the streams are not part of the total count.
      Object.keys(bufferSet).forEach(function (key) {
        total += bufferSet[key].stats.size
      })
      return total
    }
  }

  return {
    create: createBuffer,

    createStream: createStream,
    destroyStream: destroyStream,

    clear: function () {
      values(bufferSet).forEach(destroy)
      streamPool.forEach(destroy)
    },

    getBuffer: function (wrapper) {
      if (wrapper && wrapper._buffer instanceof REGLBuffer) {
        return wrapper._buffer
      }
      return null
    },

    restore: restoreBuffers,

    _initBuffer: initBufferFromData
  }
}

var points = 0;
var point = 0;
var lines = 1;
var line = 1;
var triangles = 4;
var triangle = 4;
var primTypes = {
	points: points,
	point: point,
	lines: lines,
	line: line,
	triangles: triangles,
	triangle: triangle,
	"line loop": 2,
	"line strip": 3,
	"triangle strip": 5,
	"triangle fan": 6
};

var GL_POINTS = 0
var GL_LINES = 1
var GL_TRIANGLES = 4

var GL_BYTE$2 = 5120
var GL_UNSIGNED_BYTE$4 = 5121
var GL_SHORT$2 = 5122
var GL_UNSIGNED_SHORT$2 = 5123
var GL_INT$2 = 5124
var GL_UNSIGNED_INT$2 = 5125

var GL_ELEMENT_ARRAY_BUFFER = 34963

var GL_STREAM_DRAW$1 = 0x88E0
var GL_STATIC_DRAW$1 = 0x88E4

function wrapElementsState (gl, extensions, bufferState, stats) {
  var elementSet = {}
  var elementCount = 0

  var elementTypes = {
    'uint8': GL_UNSIGNED_BYTE$4,
    'uint16': GL_UNSIGNED_SHORT$2
  }

  if (extensions.oes_element_index_uint) {
    elementTypes.uint32 = GL_UNSIGNED_INT$2
  }

  function REGLElementBuffer (buffer) {
    this.id = elementCount++
    elementSet[this.id] = this
    this.buffer = buffer
    this.primType = GL_TRIANGLES
    this.vertCount = 0
    this.type = 0
  }

  REGLElementBuffer.prototype.bind = function () {
    this.buffer.bind()
  }

  var bufferPool = []

  function createElementStream (data) {
    var result = bufferPool.pop()
    if (!result) {
      result = new REGLElementBuffer(bufferState.create(
        null,
        GL_ELEMENT_ARRAY_BUFFER,
        true,
        false)._buffer)
    }
    initElements(result, data, GL_STREAM_DRAW$1, -1, -1, 0, 0)
    return result
  }

  function destroyElementStream (elements) {
    bufferPool.push(elements)
  }

  function initElements (
    elements,
    data,
    usage,
    prim,
    count,
    byteLength,
    type) {
    elements.buffer.bind()
    var dtype
    if (data) {
      var predictedType = type
      if (!type && (
        !isTypedArray(data) ||
         (isNDArrayLike(data) && !isTypedArray(data.data)))) {
        predictedType = extensions.oes_element_index_uint
          ? GL_UNSIGNED_INT$2
          : GL_UNSIGNED_SHORT$2
      }
      bufferState._initBuffer(
        elements.buffer,
        data,
        usage,
        predictedType,
        3)
    } else {
      gl.bufferData(GL_ELEMENT_ARRAY_BUFFER, byteLength, usage)
      elements.buffer.dtype = dtype || GL_UNSIGNED_BYTE$4
      elements.buffer.usage = usage
      elements.buffer.dimension = 3
      elements.buffer.byteLength = byteLength
    }

    dtype = type
    if (!type) {
      switch (elements.buffer.dtype) {
        case GL_UNSIGNED_BYTE$4:
        case GL_BYTE$2:
          dtype = GL_UNSIGNED_BYTE$4
          break

        case GL_UNSIGNED_SHORT$2:
        case GL_SHORT$2:
          dtype = GL_UNSIGNED_SHORT$2
          break

        case GL_UNSIGNED_INT$2:
        case GL_INT$2:
          dtype = GL_UNSIGNED_INT$2
          break

        default:
          check$1.raise('unsupported type for element array')
      }
      elements.buffer.dtype = dtype
    }
    elements.type = dtype

    // Check oes_element_index_uint extension
    check$1(
      dtype !== GL_UNSIGNED_INT$2 ||
      !!extensions.oes_element_index_uint,
      '32 bit element buffers not supported, enable oes_element_index_uint first')

    // try to guess default primitive type and arguments
    var vertCount = count
    if (vertCount < 0) {
      vertCount = elements.buffer.byteLength
      if (dtype === GL_UNSIGNED_SHORT$2) {
        vertCount >>= 1
      } else if (dtype === GL_UNSIGNED_INT$2) {
        vertCount >>= 2
      }
    }
    elements.vertCount = vertCount

    // try to guess primitive type from cell dimension
    var primType = prim
    if (prim < 0) {
      primType = GL_TRIANGLES
      var dimension = elements.buffer.dimension
      if (dimension === 1) primType = GL_POINTS
      if (dimension === 2) primType = GL_LINES
      if (dimension === 3) primType = GL_TRIANGLES
    }
    elements.primType = primType
  }

  function destroyElements (elements) {
    stats.elementsCount--

    check$1(elements.buffer !== null, 'must not double destroy elements')
    delete elementSet[elements.id]
    elements.buffer.destroy()
    elements.buffer = null
  }

  function createElements (options, persistent) {
    var buffer = bufferState.create(null, GL_ELEMENT_ARRAY_BUFFER, true)
    var elements = new REGLElementBuffer(buffer._buffer)
    stats.elementsCount++

    function reglElements (options) {
      if (!options) {
        buffer()
        elements.primType = GL_TRIANGLES
        elements.vertCount = 0
        elements.type = GL_UNSIGNED_BYTE$4
      } else if (typeof options === 'number') {
        buffer(options)
        elements.primType = GL_TRIANGLES
        elements.vertCount = options | 0
        elements.type = GL_UNSIGNED_BYTE$4
      } else {
        var data = null
        var usage = GL_STATIC_DRAW$1
        var primType = -1
        var vertCount = -1
        var byteLength = 0
        var dtype = 0
        if (Array.isArray(options) ||
            isTypedArray(options) ||
            isNDArrayLike(options)) {
          data = options
        } else {
          check$1.type(options, 'object', 'invalid arguments for elements')
          if ('data' in options) {
            data = options.data
            check$1(
              Array.isArray(data) ||
                isTypedArray(data) ||
                isNDArrayLike(data),
              'invalid data for element buffer')
          }
          if ('usage' in options) {
            check$1.parameter(
              options.usage,
              usageTypes,
              'invalid element buffer usage')
            usage = usageTypes[options.usage]
          }
          if ('primitive' in options) {
            check$1.parameter(
              options.primitive,
              primTypes,
              'invalid element buffer primitive')
            primType = primTypes[options.primitive]
          }
          if ('count' in options) {
            check$1(
              typeof options.count === 'number' && options.count >= 0,
              'invalid vertex count for elements')
            vertCount = options.count | 0
          }
          if ('type' in options) {
            check$1.parameter(
              options.type,
              elementTypes,
              'invalid buffer type')
            dtype = elementTypes[options.type]
          }
          if ('length' in options) {
            byteLength = options.length | 0
          } else {
            byteLength = vertCount
            if (dtype === GL_UNSIGNED_SHORT$2 || dtype === GL_SHORT$2) {
              byteLength *= 2
            } else if (dtype === GL_UNSIGNED_INT$2 || dtype === GL_INT$2) {
              byteLength *= 4
            }
          }
        }
        initElements(
          elements,
          data,
          usage,
          primType,
          vertCount,
          byteLength,
          dtype)
      }

      return reglElements
    }

    reglElements(options)

    reglElements._reglType = 'elements'
    reglElements._elements = elements
    reglElements.subdata = function (data, offset) {
      buffer.subdata(data, offset)
      return reglElements
    }
    reglElements.destroy = function () {
      destroyElements(elements)
    }

    return reglElements
  }

  return {
    create: createElements,
    createStream: createElementStream,
    destroyStream: destroyElementStream,
    getElements: function (elements) {
      if (typeof elements === 'function' &&
          elements._elements instanceof REGLElementBuffer) {
        return elements._elements
      }
      return null
    },
    clear: function () {
      values(elementSet).forEach(destroyElements)
    }
  }
}

var FLOAT = new Float32Array(1)
var INT = new Uint32Array(FLOAT.buffer)

var GL_UNSIGNED_SHORT$4 = 5123

function convertToHalfFloat (array) {
  var ushorts = pool.allocType(GL_UNSIGNED_SHORT$4, array.length)

  for (var i = 0; i < array.length; ++i) {
    if (isNaN(array[i])) {
      ushorts[i] = 0xffff
    } else if (array[i] === Infinity) {
      ushorts[i] = 0x7c00
    } else if (array[i] === -Infinity) {
      ushorts[i] = 0xfc00
    } else {
      FLOAT[0] = array[i]
      var x = INT[0]

      var sgn = (x >>> 31) << 15
      var exp = ((x << 1) >>> 24) - 127
      var frac = (x >> 13) & ((1 << 10) - 1)

      if (exp < -24) {
        // round non-representable denormals to 0
        ushorts[i] = sgn
      } else if (exp < -14) {
        // handle denormals
        var s = -14 - exp
        ushorts[i] = sgn + ((frac + (1 << 10)) >> s)
      } else if (exp > 15) {
        // round overflow to +/- Infinity
        ushorts[i] = sgn + 0x7c00
      } else {
        // otherwise convert directly
        ushorts[i] = sgn + ((exp + 15) << 10) + frac
      }
    }
  }

  return ushorts
}

function isArrayLike (s) {
  return Array.isArray(s) || isTypedArray(s)
}

var isPow2$1 = function (v) {
  return !(v & (v - 1)) && (!!v)
}

var GL_COMPRESSED_TEXTURE_FORMATS = 0x86A3

var GL_TEXTURE_2D$1 = 0x0DE1
var GL_TEXTURE_CUBE_MAP$1 = 0x8513
var GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 = 0x8515

var GL_RGBA$1 = 0x1908
var GL_ALPHA = 0x1906
var GL_RGB = 0x1907
var GL_LUMINANCE = 0x1909
var GL_LUMINANCE_ALPHA = 0x190A

var GL_RGBA4 = 0x8056
var GL_RGB5_A1 = 0x8057
var GL_RGB565 = 0x8D62

var GL_UNSIGNED_SHORT_4_4_4_4$1 = 0x8033
var GL_UNSIGNED_SHORT_5_5_5_1$1 = 0x8034
var GL_UNSIGNED_SHORT_5_6_5$1 = 0x8363
var GL_UNSIGNED_INT_24_8_WEBGL$1 = 0x84FA

var GL_DEPTH_COMPONENT = 0x1902
var GL_DEPTH_STENCIL = 0x84F9

var GL_SRGB_EXT = 0x8C40
var GL_SRGB_ALPHA_EXT = 0x8C42

var GL_HALF_FLOAT_OES$1 = 0x8D61

var GL_COMPRESSED_RGB_S3TC_DXT1_EXT = 0x83F0
var GL_COMPRESSED_RGBA_S3TC_DXT1_EXT = 0x83F1
var GL_COMPRESSED_RGBA_S3TC_DXT3_EXT = 0x83F2
var GL_COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83F3

var GL_COMPRESSED_RGB_ATC_WEBGL = 0x8C92
var GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL = 0x8C93
var GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL = 0x87EE

var GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG = 0x8C00
var GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG = 0x8C01
var GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG = 0x8C02
var GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG = 0x8C03

var GL_COMPRESSED_RGB_ETC1_WEBGL = 0x8D64

var GL_UNSIGNED_BYTE$5 = 0x1401
var GL_UNSIGNED_SHORT$3 = 0x1403
var GL_UNSIGNED_INT$3 = 0x1405
var GL_FLOAT$4 = 0x1406

var GL_TEXTURE_WRAP_S = 0x2802
var GL_TEXTURE_WRAP_T = 0x2803

var GL_REPEAT = 0x2901
var GL_CLAMP_TO_EDGE$1 = 0x812F
var GL_MIRRORED_REPEAT = 0x8370

var GL_TEXTURE_MAG_FILTER = 0x2800
var GL_TEXTURE_MIN_FILTER = 0x2801

var GL_NEAREST$1 = 0x2600
var GL_LINEAR = 0x2601
var GL_NEAREST_MIPMAP_NEAREST$1 = 0x2700
var GL_LINEAR_MIPMAP_NEAREST$1 = 0x2701
var GL_NEAREST_MIPMAP_LINEAR$1 = 0x2702
var GL_LINEAR_MIPMAP_LINEAR$1 = 0x2703

var GL_GENERATE_MIPMAP_HINT = 0x8192
var GL_DONT_CARE = 0x1100
var GL_FASTEST = 0x1101
var GL_NICEST = 0x1102

var GL_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE

var GL_UNPACK_ALIGNMENT = 0x0CF5
var GL_UNPACK_FLIP_Y_WEBGL = 0x9240
var GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241
var GL_UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243

var GL_BROWSER_DEFAULT_WEBGL = 0x9244

var GL_TEXTURE0$1 = 0x84C0

var MIPMAP_FILTERS = [
  GL_NEAREST_MIPMAP_NEAREST$1,
  GL_NEAREST_MIPMAP_LINEAR$1,
  GL_LINEAR_MIPMAP_NEAREST$1,
  GL_LINEAR_MIPMAP_LINEAR$1
]

var CHANNELS_FORMAT = [
  0,
  GL_LUMINANCE,
  GL_LUMINANCE_ALPHA,
  GL_RGB,
  GL_RGBA$1
]

var FORMAT_CHANNELS = {}
FORMAT_CHANNELS[GL_LUMINANCE] =
FORMAT_CHANNELS[GL_ALPHA] =
FORMAT_CHANNELS[GL_DEPTH_COMPONENT] = 1
FORMAT_CHANNELS[GL_DEPTH_STENCIL] =
FORMAT_CHANNELS[GL_LUMINANCE_ALPHA] = 2
FORMAT_CHANNELS[GL_RGB] =
FORMAT_CHANNELS[GL_SRGB_EXT] = 3
FORMAT_CHANNELS[GL_RGBA$1] =
FORMAT_CHANNELS[GL_SRGB_ALPHA_EXT] = 4

function objectName (str) {
  return '[object ' + str + ']'
}

var CANVAS_CLASS = objectName('HTMLCanvasElement')
var OFFSCREENCANVAS_CLASS = objectName('OffscreenCanvas')
var CONTEXT2D_CLASS = objectName('CanvasRenderingContext2D')
var BITMAP_CLASS = objectName('ImageBitmap')
var IMAGE_CLASS = objectName('HTMLImageElement')
var VIDEO_CLASS = objectName('HTMLVideoElement')

var PIXEL_CLASSES = Object.keys(arrayTypes).concat([
  CANVAS_CLASS,
  OFFSCREENCANVAS_CLASS,
  CONTEXT2D_CLASS,
  BITMAP_CLASS,
  IMAGE_CLASS,
  VIDEO_CLASS
])

// for every texture type, store
// the size in bytes.
var TYPE_SIZES = []
TYPE_SIZES[GL_UNSIGNED_BYTE$5] = 1
TYPE_SIZES[GL_FLOAT$4] = 4
TYPE_SIZES[GL_HALF_FLOAT_OES$1] = 2

TYPE_SIZES[GL_UNSIGNED_SHORT$3] = 2
TYPE_SIZES[GL_UNSIGNED_INT$3] = 4

var FORMAT_SIZES_SPECIAL = []
FORMAT_SIZES_SPECIAL[GL_RGBA4] = 2
FORMAT_SIZES_SPECIAL[GL_RGB5_A1] = 2
FORMAT_SIZES_SPECIAL[GL_RGB565] = 2
FORMAT_SIZES_SPECIAL[GL_DEPTH_STENCIL] = 4

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_S3TC_DXT1_EXT] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT1_EXT] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT3_EXT] = 1
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_S3TC_DXT5_EXT] = 1

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_ATC_WEBGL] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL] = 1
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL] = 1

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG] = 0.25
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG] = 0.5
FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG] = 0.25

FORMAT_SIZES_SPECIAL[GL_COMPRESSED_RGB_ETC1_WEBGL] = 0.5

function isNumericArray (arr) {
  return (
    Array.isArray(arr) &&
    (arr.length === 0 ||
    typeof arr[0] === 'number'))
}

function isRectArray (arr) {
  if (!Array.isArray(arr)) {
    return false
  }
  var width = arr.length
  if (width === 0 || !isArrayLike(arr[0])) {
    return false
  }
  return true
}

function classString (x) {
  return Object.prototype.toString.call(x)
}

function isCanvasElement (object) {
  return classString(object) === CANVAS_CLASS
}

function isOffscreenCanvas (object) {
  return classString(object) === OFFSCREENCANVAS_CLASS
}

function isContext2D (object) {
  return classString(object) === CONTEXT2D_CLASS
}

function isBitmap (object) {
  return classString(object) === BITMAP_CLASS
}

function isImageElement (object) {
  return classString(object) === IMAGE_CLASS
}

function isVideoElement (object) {
  return classString(object) === VIDEO_CLASS
}

function isPixelData (object) {
  if (!object) {
    return false
  }
  var className = classString(object)
  if (PIXEL_CLASSES.indexOf(className) >= 0) {
    return true
  }
  return (
    isNumericArray(object) ||
    isRectArray(object) ||
    isNDArrayLike(object))
}

function typedArrayCode$1 (data) {
  return arrayTypes[Object.prototype.toString.call(data)] | 0
}

function convertData (result, data) {
  var n = data.length
  switch (result.type) {
    case GL_UNSIGNED_BYTE$5:
    case GL_UNSIGNED_SHORT$3:
    case GL_UNSIGNED_INT$3:
    case GL_FLOAT$4:
      var converted = pool.allocType(result.type, n)
      converted.set(data)
      result.data = converted
      break

    case GL_HALF_FLOAT_OES$1:
      result.data = convertToHalfFloat(data)
      break

    default:
      check$1.raise('unsupported texture type, must specify a typed array')
  }
}

function preConvert (image, n) {
  return pool.allocType(
    image.type === GL_HALF_FLOAT_OES$1
      ? GL_FLOAT$4
      : image.type, n)
}

function postConvert (image, data) {
  if (image.type === GL_HALF_FLOAT_OES$1) {
    image.data = convertToHalfFloat(data)
    pool.freeType(data)
  } else {
    image.data = data
  }
}

function transposeData (image, array, strideX, strideY, strideC, offset) {
  var w = image.width
  var h = image.height
  var c = image.channels
  var n = w * h * c
  var data = preConvert(image, n)

  var p = 0
  for (var i = 0; i < h; ++i) {
    for (var j = 0; j < w; ++j) {
      for (var k = 0; k < c; ++k) {
        data[p++] = array[strideX * j + strideY * i + strideC * k + offset]
      }
    }
  }

  postConvert(image, data)
}

function getTextureSize (format, type, width, height, isMipmap, isCube) {
  var s
  if (typeof FORMAT_SIZES_SPECIAL[format] !== 'undefined') {
    // we have a special array for dealing with weird color formats such as RGB5A1
    s = FORMAT_SIZES_SPECIAL[format]
  } else {
    s = FORMAT_CHANNELS[format] * TYPE_SIZES[type]
  }

  if (isCube) {
    s *= 6
  }

  if (isMipmap) {
    // compute the total size of all the mipmaps.
    var total = 0

    var w = width
    while (w >= 1) {
      // we can only use mipmaps on a square image,
      // so we can simply use the width and ignore the height:
      total += s * w * w
      w /= 2
    }
    return total
  } else {
    return s * width * height
  }
}

function createTextureSet (
  gl, extensions, limits, reglPoll, contextState, stats, config) {
  // -------------------------------------------------------
  // Initialize constants and parameter tables here
  // -------------------------------------------------------
  var mipmapHint = {
    "don't care": GL_DONT_CARE,
    'dont care': GL_DONT_CARE,
    'nice': GL_NICEST,
    'fast': GL_FASTEST
  }

  var wrapModes = {
    'repeat': GL_REPEAT,
    'clamp': GL_CLAMP_TO_EDGE$1,
    'mirror': GL_MIRRORED_REPEAT
  }

  var magFilters = {
    'nearest': GL_NEAREST$1,
    'linear': GL_LINEAR
  }

  var minFilters = extend({
    'mipmap': GL_LINEAR_MIPMAP_LINEAR$1,
    'nearest mipmap nearest': GL_NEAREST_MIPMAP_NEAREST$1,
    'linear mipmap nearest': GL_LINEAR_MIPMAP_NEAREST$1,
    'nearest mipmap linear': GL_NEAREST_MIPMAP_LINEAR$1,
    'linear mipmap linear': GL_LINEAR_MIPMAP_LINEAR$1
  }, magFilters)

  var colorSpace = {
    'none': 0,
    'browser': GL_BROWSER_DEFAULT_WEBGL
  }

  var textureTypes = {
    'uint8': GL_UNSIGNED_BYTE$5,
    'rgba4': GL_UNSIGNED_SHORT_4_4_4_4$1,
    'rgb565': GL_UNSIGNED_SHORT_5_6_5$1,
    'rgb5 a1': GL_UNSIGNED_SHORT_5_5_5_1$1
  }

  var textureFormats = {
    'alpha': GL_ALPHA,
    'luminance': GL_LUMINANCE,
    'luminance alpha': GL_LUMINANCE_ALPHA,
    'rgb': GL_RGB,
    'rgba': GL_RGBA$1,
    'rgba4': GL_RGBA4,
    'rgb5 a1': GL_RGB5_A1,
    'rgb565': GL_RGB565
  }

  var compressedTextureFormats = {}

  if (extensions.ext_srgb) {
    textureFormats.srgb = GL_SRGB_EXT
    textureFormats.srgba = GL_SRGB_ALPHA_EXT
  }

  if (extensions.oes_texture_float) {
    textureTypes.float32 = textureTypes.float = GL_FLOAT$4
  }

  if (extensions.oes_texture_half_float) {
    textureTypes['float16'] = textureTypes['half float'] = GL_HALF_FLOAT_OES$1
  }

  if (extensions.webgl_depth_texture) {
    extend(textureFormats, {
      'depth': GL_DEPTH_COMPONENT,
      'depth stencil': GL_DEPTH_STENCIL
    })

    extend(textureTypes, {
      'uint16': GL_UNSIGNED_SHORT$3,
      'uint32': GL_UNSIGNED_INT$3,
      'depth stencil': GL_UNSIGNED_INT_24_8_WEBGL$1
    })
  }

  if (extensions.webgl_compressed_texture_s3tc) {
    extend(compressedTextureFormats, {
      'rgb s3tc dxt1': GL_COMPRESSED_RGB_S3TC_DXT1_EXT,
      'rgba s3tc dxt1': GL_COMPRESSED_RGBA_S3TC_DXT1_EXT,
      'rgba s3tc dxt3': GL_COMPRESSED_RGBA_S3TC_DXT3_EXT,
      'rgba s3tc dxt5': GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
    })
  }

  if (extensions.webgl_compressed_texture_atc) {
    extend(compressedTextureFormats, {
      'rgb atc': GL_COMPRESSED_RGB_ATC_WEBGL,
      'rgba atc explicit alpha': GL_COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL,
      'rgba atc interpolated alpha': GL_COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL
    })
  }

  if (extensions.webgl_compressed_texture_pvrtc) {
    extend(compressedTextureFormats, {
      'rgb pvrtc 4bppv1': GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
      'rgb pvrtc 2bppv1': GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG,
      'rgba pvrtc 4bppv1': GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
      'rgba pvrtc 2bppv1': GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG
    })
  }

  if (extensions.webgl_compressed_texture_etc1) {
    compressedTextureFormats['rgb etc1'] = GL_COMPRESSED_RGB_ETC1_WEBGL
  }

  // Copy over all texture formats
  var supportedCompressedFormats = Array.prototype.slice.call(
    gl.getParameter(GL_COMPRESSED_TEXTURE_FORMATS))
  Object.keys(compressedTextureFormats).forEach(function (name) {
    var format = compressedTextureFormats[name]
    if (supportedCompressedFormats.indexOf(format) >= 0) {
      textureFormats[name] = format
    }
  })

  var supportedFormats = Object.keys(textureFormats)
  limits.textureFormats = supportedFormats

  // associate with every format string its
  // corresponding GL-value.
  var textureFormatsInvert = []
  Object.keys(textureFormats).forEach(function (key) {
    var val = textureFormats[key]
    textureFormatsInvert[val] = key
  })

  // associate with every type string its
  // corresponding GL-value.
  var textureTypesInvert = []
  Object.keys(textureTypes).forEach(function (key) {
    var val = textureTypes[key]
    textureTypesInvert[val] = key
  })

  var magFiltersInvert = []
  Object.keys(magFilters).forEach(function (key) {
    var val = magFilters[key]
    magFiltersInvert[val] = key
  })

  var minFiltersInvert = []
  Object.keys(minFilters).forEach(function (key) {
    var val = minFilters[key]
    minFiltersInvert[val] = key
  })

  var wrapModesInvert = []
  Object.keys(wrapModes).forEach(function (key) {
    var val = wrapModes[key]
    wrapModesInvert[val] = key
  })

  // colorFormats[] gives the format (channels) associated to an
  // internalformat
  var colorFormats = supportedFormats.reduce(function (color, key) {
    var glenum = textureFormats[key]
    if (glenum === GL_LUMINANCE ||
        glenum === GL_ALPHA ||
        glenum === GL_LUMINANCE ||
        glenum === GL_LUMINANCE_ALPHA ||
        glenum === GL_DEPTH_COMPONENT ||
        glenum === GL_DEPTH_STENCIL ||
        (extensions.ext_srgb &&
                (glenum === GL_SRGB_EXT ||
                 glenum === GL_SRGB_ALPHA_EXT))) {
      color[glenum] = glenum
    } else if (glenum === GL_RGB5_A1 || key.indexOf('rgba') >= 0) {
      color[glenum] = GL_RGBA$1
    } else {
      color[glenum] = GL_RGB
    }
    return color
  }, {})

  function TexFlags () {
    // format info
    this.internalformat = GL_RGBA$1
    this.format = GL_RGBA$1
    this.type = GL_UNSIGNED_BYTE$5
    this.compressed = false

    // pixel storage
    this.premultiplyAlpha = false
    this.flipY = false
    this.unpackAlignment = 1
    this.colorSpace = GL_BROWSER_DEFAULT_WEBGL

    // shape info
    this.width = 0
    this.height = 0
    this.channels = 0
  }

  function copyFlags (result, other) {
    result.internalformat = other.internalformat
    result.format = other.format
    result.type = other.type
    result.compressed = other.compressed

    result.premultiplyAlpha = other.premultiplyAlpha
    result.flipY = other.flipY
    result.unpackAlignment = other.unpackAlignment
    result.colorSpace = other.colorSpace

    result.width = other.width
    result.height = other.height
    result.channels = other.channels
  }

  function parseFlags (flags, options) {
    if (typeof options !== 'object' || !options) {
      return
    }

    if ('premultiplyAlpha' in options) {
      check$1.type(options.premultiplyAlpha, 'boolean',
        'invalid premultiplyAlpha')
      flags.premultiplyAlpha = options.premultiplyAlpha
    }

    if ('flipY' in options) {
      check$1.type(options.flipY, 'boolean',
        'invalid texture flip')
      flags.flipY = options.flipY
    }

    if ('alignment' in options) {
      check$1.oneOf(options.alignment, [1, 2, 4, 8],
        'invalid texture unpack alignment')
      flags.unpackAlignment = options.alignment
    }

    if ('colorSpace' in options) {
      check$1.parameter(options.colorSpace, colorSpace,
        'invalid colorSpace')
      flags.colorSpace = colorSpace[options.colorSpace]
    }

    if ('type' in options) {
      var type = options.type
      check$1(extensions.oes_texture_float ||
        !(type === 'float' || type === 'float32'),
      'you must enable the OES_texture_float extension in order to use floating point textures.')
      check$1(extensions.oes_texture_half_float ||
        !(type === 'half float' || type === 'float16'),
      'you must enable the OES_texture_half_float extension in order to use 16-bit floating point textures.')
      check$1(extensions.webgl_depth_texture ||
        !(type === 'uint16' || type === 'uint32' || type === 'depth stencil'),
      'you must enable the WEBGL_depth_texture extension in order to use depth/stencil textures.')
      check$1.parameter(type, textureTypes,
        'invalid texture type')
      flags.type = textureTypes[type]
    }

    var w = flags.width
    var h = flags.height
    var c = flags.channels
    var hasChannels = false
    if ('shape' in options) {
      check$1(Array.isArray(options.shape) && options.shape.length >= 2,
        'shape must be an array')
      w = options.shape[0]
      h = options.shape[1]
      if (options.shape.length === 3) {
        c = options.shape[2]
        check$1(c > 0 && c <= 4, 'invalid number of channels')
        hasChannels = true
      }
      check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid width')
      check$1(h >= 0 && h <= limits.maxTextureSize, 'invalid height')
    } else {
      if ('radius' in options) {
        w = h = options.radius
        check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid radius')
      }
      if ('width' in options) {
        w = options.width
        check$1(w >= 0 && w <= limits.maxTextureSize, 'invalid width')
      }
      if ('height' in options) {
        h = options.height
        check$1(h >= 0 && h <= limits.maxTextureSize, 'invalid height')
      }
      if ('channels' in options) {
        c = options.channels
        check$1(c > 0 && c <= 4, 'invalid number of channels')
        hasChannels = true
      }
    }
    flags.width = w | 0
    flags.height = h | 0
    flags.channels = c | 0

    var hasFormat = false
    if ('format' in options) {
      var formatStr = options.format
      check$1(extensions.webgl_depth_texture ||
        !(formatStr === 'depth' || formatStr === 'depth stencil'),
      'you must enable the WEBGL_depth_texture extension in order to use depth/stencil textures.')
      check$1.parameter(formatStr, textureFormats,
        'invalid texture format')
      var internalformat = flags.internalformat = textureFormats[formatStr]
      flags.format = colorFormats[internalformat]
      if (formatStr in textureTypes) {
        if (!('type' in options)) {
          flags.type = textureTypes[formatStr]
        }
      }
      if (formatStr in compressedTextureFormats) {
        flags.compressed = true
      }
      hasFormat = true
    }

    // Reconcile channels and format
    if (!hasChannels && hasFormat) {
      flags.channels = FORMAT_CHANNELS[flags.format]
    } else if (hasChannels && !hasFormat) {
      if (flags.channels !== CHANNELS_FORMAT[flags.format]) {
        flags.format = flags.internalformat = CHANNELS_FORMAT[flags.channels]
      }
    } else if (hasFormat && hasChannels) {
      check$1(
        flags.channels === FORMAT_CHANNELS[flags.format],
        'number of channels inconsistent with specified format')
    }
  }

  function setFlags (flags) {
    gl.pixelStorei(GL_UNPACK_FLIP_Y_WEBGL, flags.flipY)
    gl.pixelStorei(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, flags.premultiplyAlpha)
    gl.pixelStorei(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL, flags.colorSpace)
    gl.pixelStorei(GL_UNPACK_ALIGNMENT, flags.unpackAlignment)
  }

  // -------------------------------------------------------
  // Tex image data
  // -------------------------------------------------------
  function TexImage () {
    TexFlags.call(this)

    this.xOffset = 0
    this.yOffset = 0

    // data
    this.data = null
    this.needsFree = false

    // html element
    this.element = null

    // copyTexImage info
    this.needsCopy = false
  }

  function parseImage (image, options) {
    var data = null
    if (isPixelData(options)) {
      data = options
    } else if (options) {
      check$1.type(options, 'object', 'invalid pixel data type')
      parseFlags(image, options)
      if ('x' in options) {
        image.xOffset = options.x | 0
      }
      if ('y' in options) {
        image.yOffset = options.y | 0
      }
      if (isPixelData(options.data)) {
        data = options.data
      }
    }

    check$1(
      !image.compressed ||
      data instanceof Uint8Array,
      'compressed texture data must be stored in a uint8array')

    if (options.copy) {
      check$1(!data, 'can not specify copy and data field for the same texture')
      var viewW = contextState.viewportWidth
      var viewH = contextState.viewportHeight
      image.width = image.width || (viewW - image.xOffset)
      image.height = image.height || (viewH - image.yOffset)
      image.needsCopy = true
      check$1(image.xOffset >= 0 && image.xOffset < viewW &&
            image.yOffset >= 0 && image.yOffset < viewH &&
            image.width > 0 && image.width <= viewW &&
            image.height > 0 && image.height <= viewH,
      'copy texture read out of bounds')
    } else if (!data) {
      image.width = image.width || 1
      image.height = image.height || 1
      image.channels = image.channels || 4
    } else if (isTypedArray(data)) {
      image.channels = image.channels || 4
      image.data = data
      if (!('type' in options) && image.type === GL_UNSIGNED_BYTE$5) {
        image.type = typedArrayCode$1(data)
      }
    } else if (isNumericArray(data)) {
      image.channels = image.channels || 4
      convertData(image, data)
      image.alignment = 1
      image.needsFree = true
    } else if (isNDArrayLike(data)) {
      var array = data.data
      if (!Array.isArray(array) && image.type === GL_UNSIGNED_BYTE$5) {
        image.type = typedArrayCode$1(array)
      }
      var shape = data.shape
      var stride = data.stride
      var shapeX, shapeY, shapeC, strideX, strideY, strideC
      if (shape.length === 3) {
        shapeC = shape[2]
        strideC = stride[2]
      } else {
        check$1(shape.length === 2, 'invalid ndarray pixel data, must be 2 or 3D')
        shapeC = 1
        strideC = 1
      }
      shapeX = shape[0]
      shapeY = shape[1]
      strideX = stride[0]
      strideY = stride[1]
      image.alignment = 1
      image.width = shapeX
      image.height = shapeY
      image.channels = shapeC
      image.format = image.internalformat = CHANNELS_FORMAT[shapeC]
      image.needsFree = true
      transposeData(image, array, strideX, strideY, strideC, data.offset)
    } else if (isCanvasElement(data) || isOffscreenCanvas(data) || isContext2D(data)) {
      if (isCanvasElement(data) || isOffscreenCanvas(data)) {
        image.element = data
      } else {
        image.element = data.canvas
      }
      image.width = image.element.width
      image.height = image.element.height
      image.channels = 4
    } else if (isBitmap(data)) {
      image.element = data
      image.width = data.width
      image.height = data.height
      image.channels = 4
    } else if (isImageElement(data)) {
      image.element = data
      image.width = data.naturalWidth
      image.height = data.naturalHeight
      image.channels = 4
    } else if (isVideoElement(data)) {
      image.element = data
      image.width = data.videoWidth
      image.height = data.videoHeight
      image.channels = 4
    } else if (isRectArray(data)) {
      var w = image.width || data[0].length
      var h = image.height || data.length
      var c = image.channels
      if (isArrayLike(data[0][0])) {
        c = c || data[0][0].length
      } else {
        c = c || 1
      }
      var arrayShape = flattenUtils.shape(data)
      var n = 1
      for (var dd = 0; dd < arrayShape.length; ++dd) {
        n *= arrayShape[dd]
      }
      var allocData = preConvert(image, n)
      flattenUtils.flatten(data, arrayShape, '', allocData)
      postConvert(image, allocData)
      image.alignment = 1
      image.width = w
      image.height = h
      image.channels = c
      image.format = image.internalformat = CHANNELS_FORMAT[c]
      image.needsFree = true
    }

    if (image.type === GL_FLOAT$4) {
      check$1(limits.extensions.indexOf('oes_texture_float') >= 0,
        'oes_texture_float extension not enabled')
    } else if (image.type === GL_HALF_FLOAT_OES$1) {
      check$1(limits.extensions.indexOf('oes_texture_half_float') >= 0,
        'oes_texture_half_float extension not enabled')
    }

    // do compressed texture  validation here.
  }

  function setImage (info, target, miplevel) {
    var element = info.element
    var data = info.data
    var internalformat = info.internalformat
    var format = info.format
    var type = info.type
    var width = info.width
    var height = info.height

    setFlags(info)

    if (element) {
      gl.texImage2D(target, miplevel, format, format, type, element)
    } else if (info.compressed) {
      gl.compressedTexImage2D(target, miplevel, internalformat, width, height, 0, data)
    } else if (info.needsCopy) {
      reglPoll()
      gl.copyTexImage2D(
        target, miplevel, format, info.xOffset, info.yOffset, width, height, 0)
    } else {
      gl.texImage2D(target, miplevel, format, width, height, 0, format, type, data || null)
    }
  }

  function setSubImage (info, target, x, y, miplevel) {
    var element = info.element
    var data = info.data
    var internalformat = info.internalformat
    var format = info.format
    var type = info.type
    var width = info.width
    var height = info.height

    setFlags(info)

    if (element) {
      gl.texSubImage2D(
        target, miplevel, x, y, format, type, element)
    } else if (info.compressed) {
      gl.compressedTexSubImage2D(
        target, miplevel, x, y, internalformat, width, height, data)
    } else if (info.needsCopy) {
      reglPoll()
      gl.copyTexSubImage2D(
        target, miplevel, x, y, info.xOffset, info.yOffset, width, height)
    } else {
      gl.texSubImage2D(
        target, miplevel, x, y, width, height, format, type, data)
    }
  }

  // texImage pool
  var imagePool = []

  function allocImage () {
    return imagePool.pop() || new TexImage()
  }

  function freeImage (image) {
    if (image.needsFree) {
      pool.freeType(image.data)
    }
    TexImage.call(image)
    imagePool.push(image)
  }

  // -------------------------------------------------------
  // Mip map
  // -------------------------------------------------------
  function MipMap () {
    TexFlags.call(this)

    this.genMipmaps = false
    this.mipmapHint = GL_DONT_CARE
    this.mipmask = 0
    this.images = Array(16)
  }

  function parseMipMapFromShape (mipmap, width, height) {
    var img = mipmap.images[0] = allocImage()
    mipmap.mipmask = 1
    img.width = mipmap.width = width
    img.height = mipmap.height = height
    img.channels = mipmap.channels = 4
  }

  function parseMipMapFromObject (mipmap, options) {
    var imgData = null
    if (isPixelData(options)) {
      imgData = mipmap.images[0] = allocImage()
      copyFlags(imgData, mipmap)
      parseImage(imgData, options)
      mipmap.mipmask = 1
    } else {
      parseFlags(mipmap, options)
      if (Array.isArray(options.mipmap)) {
        var mipData = options.mipmap
        for (var i = 0; i < mipData.length; ++i) {
          imgData = mipmap.images[i] = allocImage()
          copyFlags(imgData, mipmap)
          imgData.width >>= i
          imgData.height >>= i
          parseImage(imgData, mipData[i])
          mipmap.mipmask |= (1 << i)
        }
      } else {
        imgData = mipmap.images[0] = allocImage()
        copyFlags(imgData, mipmap)
        parseImage(imgData, options)
        mipmap.mipmask = 1
      }
    }
    copyFlags(mipmap, mipmap.images[0])

    // For textures of the compressed format WEBGL_compressed_texture_s3tc
    // we must have that
    //
    // "When level equals zero width and height must be a multiple of 4.
    // When level is greater than 0 width and height must be 0, 1, 2 or a multiple of 4. "
    //
    // but we do not yet support having multiple mipmap levels for compressed textures,
    // so we only test for level zero.

    if (
      mipmap.compressed &&
      (
        mipmap.internalformat === GL_COMPRESSED_RGB_S3TC_DXT1_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT1_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT3_EXT ||
        mipmap.internalformat === GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
      )
    ) {
      check$1(mipmap.width % 4 === 0 && mipmap.height % 4 === 0,
        'for compressed texture formats, mipmap level 0 must have width and height that are a multiple of 4')
    }
  }

  function setMipMap (mipmap, target) {
    var images = mipmap.images
    for (var i = 0; i < images.length; ++i) {
      if (!images[i]) {
        return
      }
      setImage(images[i], target, i)
    }
  }

  var mipPool = []

  function allocMipMap () {
    var result = mipPool.pop() || new MipMap()
    TexFlags.call(result)
    result.mipmask = 0
    for (var i = 0; i < 16; ++i) {
      result.images[i] = null
    }
    return result
  }

  function freeMipMap (mipmap) {
    var images = mipmap.images
    for (var i = 0; i < images.length; ++i) {
      if (images[i]) {
        freeImage(images[i])
      }
      images[i] = null
    }
    mipPool.push(mipmap)
  }

  // -------------------------------------------------------
  // Tex info
  // -------------------------------------------------------
  function TexInfo () {
    this.minFilter = GL_NEAREST$1
    this.magFilter = GL_NEAREST$1

    this.wrapS = GL_CLAMP_TO_EDGE$1
    this.wrapT = GL_CLAMP_TO_EDGE$1

    this.anisotropic = 1

    this.genMipmaps = false
    this.mipmapHint = GL_DONT_CARE
  }

  function parseTexInfo (info, options) {
    if ('min' in options) {
      var minFilter = options.min
      check$1.parameter(minFilter, minFilters)
      info.minFilter = minFilters[minFilter]
      if (MIPMAP_FILTERS.indexOf(info.minFilter) >= 0 && !('faces' in options)) {
        info.genMipmaps = true
      }
    }

    if ('mag' in options) {
      var magFilter = options.mag
      check$1.parameter(magFilter, magFilters)
      info.magFilter = magFilters[magFilter]
    }

    var wrapS = info.wrapS
    var wrapT = info.wrapT
    if ('wrap' in options) {
      var wrap = options.wrap
      if (typeof wrap === 'string') {
        check$1.parameter(wrap, wrapModes)
        wrapS = wrapT = wrapModes[wrap]
      } else if (Array.isArray(wrap)) {
        check$1.parameter(wrap[0], wrapModes)
        check$1.parameter(wrap[1], wrapModes)
        wrapS = wrapModes[wrap[0]]
        wrapT = wrapModes[wrap[1]]
      }
    } else {
      if ('wrapS' in options) {
        var optWrapS = options.wrapS
        check$1.parameter(optWrapS, wrapModes)
        wrapS = wrapModes[optWrapS]
      }
      if ('wrapT' in options) {
        var optWrapT = options.wrapT
        check$1.parameter(optWrapT, wrapModes)
        wrapT = wrapModes[optWrapT]
      }
    }
    info.wrapS = wrapS
    info.wrapT = wrapT

    if ('anisotropic' in options) {
      var anisotropic = options.anisotropic
      check$1(typeof anisotropic === 'number' &&
         anisotropic >= 1 && anisotropic <= limits.maxAnisotropic,
      'aniso samples must be between 1 and ')
      info.anisotropic = options.anisotropic
    }

    if ('mipmap' in options) {
      var hasMipMap = false
      switch (typeof options.mipmap) {
        case 'string':
          check$1.parameter(options.mipmap, mipmapHint,
            'invalid mipmap hint')
          info.mipmapHint = mipmapHint[options.mipmap]
          info.genMipmaps = true
          hasMipMap = true
          break

        case 'boolean':
          hasMipMap = info.genMipmaps = options.mipmap
          break

        case 'object':
          check$1(Array.isArray(options.mipmap), 'invalid mipmap type')
          info.genMipmaps = false
          hasMipMap = true
          break

        default:
          check$1.raise('invalid mipmap type')
      }
      if (hasMipMap && !('min' in options)) {
        info.minFilter = GL_NEAREST_MIPMAP_NEAREST$1
      }
    }
  }

  function setTexInfo (info, target) {
    gl.texParameteri(target, GL_TEXTURE_MIN_FILTER, info.minFilter)
    gl.texParameteri(target, GL_TEXTURE_MAG_FILTER, info.magFilter)
    gl.texParameteri(target, GL_TEXTURE_WRAP_S, info.wrapS)
    gl.texParameteri(target, GL_TEXTURE_WRAP_T, info.wrapT)
    if (extensions.ext_texture_filter_anisotropic) {
      gl.texParameteri(target, GL_TEXTURE_MAX_ANISOTROPY_EXT, info.anisotropic)
    }
    if (info.genMipmaps) {
      gl.hint(GL_GENERATE_MIPMAP_HINT, info.mipmapHint)
      gl.generateMipmap(target)
    }
  }

  // -------------------------------------------------------
  // Full texture object
  // -------------------------------------------------------
  var textureCount = 0
  var textureSet = {}
  var numTexUnits = limits.maxTextureUnits
  var textureUnits = Array(numTexUnits).map(function () {
    return null
  })

  function REGLTexture (target) {
    TexFlags.call(this)
    this.mipmask = 0
    this.internalformat = GL_RGBA$1

    this.id = textureCount++

    this.refCount = 1

    this.target = target
    this.texture = gl.createTexture()

    this.unit = -1
    this.bindCount = 0

    this.texInfo = new TexInfo()

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  function tempBind (texture) {
    gl.activeTexture(GL_TEXTURE0$1)
    gl.bindTexture(texture.target, texture.texture)
  }

  function tempRestore () {
    var prev = textureUnits[0]
    if (prev) {
      gl.bindTexture(prev.target, prev.texture)
    } else {
      gl.bindTexture(GL_TEXTURE_2D$1, null)
    }
  }

  function destroy (texture) {
    var handle = texture.texture
    check$1(handle, 'must not double destroy texture')
    var unit = texture.unit
    var target = texture.target
    if (unit >= 0) {
      gl.activeTexture(GL_TEXTURE0$1 + unit)
      gl.bindTexture(target, null)
      textureUnits[unit] = null
    }
    gl.deleteTexture(handle)
    texture.texture = null
    texture.params = null
    texture.pixels = null
    texture.refCount = 0
    delete textureSet[texture.id]
    stats.textureCount--
  }

  extend(REGLTexture.prototype, {
    bind: function () {
      var texture = this
      texture.bindCount += 1
      var unit = texture.unit
      if (unit < 0) {
        for (var i = 0; i < numTexUnits; ++i) {
          var other = textureUnits[i]
          if (other) {
            if (other.bindCount > 0) {
              continue
            }
            other.unit = -1
          }
          textureUnits[i] = texture
          unit = i
          break
        }
        if (unit >= numTexUnits) {
          check$1.raise('insufficient number of texture units')
        }
        if (config.profile && stats.maxTextureUnits < (unit + 1)) {
          stats.maxTextureUnits = unit + 1 // +1, since the units are zero-based
        }
        texture.unit = unit
        gl.activeTexture(GL_TEXTURE0$1 + unit)
        gl.bindTexture(texture.target, texture.texture)
      }
      return unit
    },

    unbind: function () {
      this.bindCount -= 1
    },

    decRef: function () {
      if (--this.refCount <= 0) {
        destroy(this)
      }
    }
  })

  function createTexture2D (a, b) {
    var texture = new REGLTexture(GL_TEXTURE_2D$1)
    textureSet[texture.id] = texture
    stats.textureCount++

    function reglTexture2D (a, b) {
      var texInfo = texture.texInfo
      TexInfo.call(texInfo)
      var mipData = allocMipMap()

      if (typeof a === 'number') {
        if (typeof b === 'number') {
          parseMipMapFromShape(mipData, a | 0, b | 0)
        } else {
          parseMipMapFromShape(mipData, a | 0, a | 0)
        }
      } else if (a) {
        check$1.type(a, 'object', 'invalid arguments to regl.texture')
        parseTexInfo(texInfo, a)
        parseMipMapFromObject(mipData, a)
      } else {
        // empty textures get assigned a default shape of 1x1
        parseMipMapFromShape(mipData, 1, 1)
      }

      if (texInfo.genMipmaps) {
        mipData.mipmask = (mipData.width << 1) - 1
      }
      texture.mipmask = mipData.mipmask

      copyFlags(texture, mipData)

      check$1.texture2D(texInfo, mipData, limits)
      texture.internalformat = mipData.internalformat

      reglTexture2D.width = mipData.width
      reglTexture2D.height = mipData.height

      tempBind(texture)
      setMipMap(mipData, GL_TEXTURE_2D$1)
      setTexInfo(texInfo, GL_TEXTURE_2D$1)
      tempRestore()

      freeMipMap(mipData)

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          mipData.width,
          mipData.height,
          texInfo.genMipmaps,
          false)
      }
      reglTexture2D.format = textureFormatsInvert[texture.internalformat]
      reglTexture2D.type = textureTypesInvert[texture.type]

      reglTexture2D.mag = magFiltersInvert[texInfo.magFilter]
      reglTexture2D.min = minFiltersInvert[texInfo.minFilter]

      reglTexture2D.wrapS = wrapModesInvert[texInfo.wrapS]
      reglTexture2D.wrapT = wrapModesInvert[texInfo.wrapT]

      return reglTexture2D
    }

    function subimage (image, x_, y_, level_) {
      check$1(!!image, 'must specify image data')

      var x = x_ | 0
      var y = y_ | 0
      var level = level_ | 0

      var imageData = allocImage()
      copyFlags(imageData, texture)
      imageData.width = 0
      imageData.height = 0
      parseImage(imageData, image)
      imageData.width = imageData.width || ((texture.width >> level) - x)
      imageData.height = imageData.height || ((texture.height >> level) - y)

      check$1(
        texture.type === imageData.type &&
        texture.format === imageData.format &&
        texture.internalformat === imageData.internalformat,
        'incompatible format for texture.subimage')
      check$1(
        x >= 0 && y >= 0 &&
        x + imageData.width <= texture.width &&
        y + imageData.height <= texture.height,
        'texture.subimage write out of bounds')
      check$1(
        texture.mipmask & (1 << level),
        'missing mipmap data')
      check$1(
        imageData.data || imageData.element || imageData.needsCopy,
        'missing image data')

      tempBind(texture)
      setSubImage(imageData, GL_TEXTURE_2D$1, x, y, level)
      tempRestore()

      freeImage(imageData)

      return reglTexture2D
    }

    function resize (w_, h_) {
      var w = w_ | 0
      var h = (h_ | 0) || w
      if (w === texture.width && h === texture.height) {
        return reglTexture2D
      }

      reglTexture2D.width = texture.width = w
      reglTexture2D.height = texture.height = h

      tempBind(texture)

      for (var i = 0; texture.mipmask >> i; ++i) {
        var _w = w >> i
        var _h = h >> i
        if (!_w || !_h) break
        gl.texImage2D(
          GL_TEXTURE_2D$1,
          i,
          texture.format,
          _w,
          _h,
          0,
          texture.format,
          texture.type,
          null)
      }
      tempRestore()

      // also, recompute the texture size.
      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          w,
          h,
          false,
          false)
      }

      return reglTexture2D
    }

    reglTexture2D(a, b)

    reglTexture2D.subimage = subimage
    reglTexture2D.resize = resize
    reglTexture2D._reglType = 'texture2d'
    reglTexture2D._texture = texture
    if (config.profile) {
      reglTexture2D.stats = texture.stats
    }
    reglTexture2D.destroy = function () {
      texture.decRef()
    }

    return reglTexture2D
  }

  function createTextureCube (a0, a1, a2, a3, a4, a5) {
    var texture = new REGLTexture(GL_TEXTURE_CUBE_MAP$1)
    textureSet[texture.id] = texture
    stats.cubeCount++

    var faces = new Array(6)

    function reglTextureCube (a0, a1, a2, a3, a4, a5) {
      var i
      var texInfo = texture.texInfo
      TexInfo.call(texInfo)
      for (i = 0; i < 6; ++i) {
        faces[i] = allocMipMap()
      }

      if (typeof a0 === 'number' || !a0) {
        var s = (a0 | 0) || 1
        for (i = 0; i < 6; ++i) {
          parseMipMapFromShape(faces[i], s, s)
        }
      } else if (typeof a0 === 'object') {
        if (a1) {
          parseMipMapFromObject(faces[0], a0)
          parseMipMapFromObject(faces[1], a1)
          parseMipMapFromObject(faces[2], a2)
          parseMipMapFromObject(faces[3], a3)
          parseMipMapFromObject(faces[4], a4)
          parseMipMapFromObject(faces[5], a5)
        } else {
          parseTexInfo(texInfo, a0)
          parseFlags(texture, a0)
          if ('faces' in a0) {
            var faceInput = a0.faces
            check$1(Array.isArray(faceInput) && faceInput.length === 6,
              'cube faces must be a length 6 array')
            for (i = 0; i < 6; ++i) {
              check$1(typeof faceInput[i] === 'object' && !!faceInput[i],
                'invalid input for cube map face')
              copyFlags(faces[i], texture)
              parseMipMapFromObject(faces[i], faceInput[i])
            }
          } else {
            for (i = 0; i < 6; ++i) {
              parseMipMapFromObject(faces[i], a0)
            }
          }
        }
      } else {
        check$1.raise('invalid arguments to cube map')
      }

      copyFlags(texture, faces[0])
      check$1.optional(function () {
        if (!limits.npotTextureCube) {
          check$1(isPow2$1(texture.width) && isPow2$1(texture.height), 'your browser does not support non power or two texture dimensions')
        }
      })

      if (texInfo.genMipmaps) {
        texture.mipmask = (faces[0].width << 1) - 1
      } else {
        texture.mipmask = faces[0].mipmask
      }

      check$1.textureCube(texture, texInfo, faces, limits)
      texture.internalformat = faces[0].internalformat

      reglTextureCube.width = faces[0].width
      reglTextureCube.height = faces[0].height

      tempBind(texture)
      for (i = 0; i < 6; ++i) {
        setMipMap(faces[i], GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + i)
      }
      setTexInfo(texInfo, GL_TEXTURE_CUBE_MAP$1)
      tempRestore()

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          reglTextureCube.width,
          reglTextureCube.height,
          texInfo.genMipmaps,
          true)
      }

      reglTextureCube.format = textureFormatsInvert[texture.internalformat]
      reglTextureCube.type = textureTypesInvert[texture.type]

      reglTextureCube.mag = magFiltersInvert[texInfo.magFilter]
      reglTextureCube.min = minFiltersInvert[texInfo.minFilter]

      reglTextureCube.wrapS = wrapModesInvert[texInfo.wrapS]
      reglTextureCube.wrapT = wrapModesInvert[texInfo.wrapT]

      for (i = 0; i < 6; ++i) {
        freeMipMap(faces[i])
      }

      return reglTextureCube
    }

    function subimage (face, image, x_, y_, level_) {
      check$1(!!image, 'must specify image data')
      check$1(typeof face === 'number' && face === (face | 0) &&
        face >= 0 && face < 6, 'invalid face')

      var x = x_ | 0
      var y = y_ | 0
      var level = level_ | 0

      var imageData = allocImage()
      copyFlags(imageData, texture)
      imageData.width = 0
      imageData.height = 0
      parseImage(imageData, image)
      imageData.width = imageData.width || ((texture.width >> level) - x)
      imageData.height = imageData.height || ((texture.height >> level) - y)

      check$1(
        texture.type === imageData.type &&
        texture.format === imageData.format &&
        texture.internalformat === imageData.internalformat,
        'incompatible format for texture.subimage')
      check$1(
        x >= 0 && y >= 0 &&
        x + imageData.width <= texture.width &&
        y + imageData.height <= texture.height,
        'texture.subimage write out of bounds')
      check$1(
        texture.mipmask & (1 << level),
        'missing mipmap data')
      check$1(
        imageData.data || imageData.element || imageData.needsCopy,
        'missing image data')

      tempBind(texture)
      setSubImage(imageData, GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + face, x, y, level)
      tempRestore()

      freeImage(imageData)

      return reglTextureCube
    }

    function resize (radius_) {
      var radius = radius_ | 0
      if (radius === texture.width) {
        return
      }

      reglTextureCube.width = texture.width = radius
      reglTextureCube.height = texture.height = radius

      tempBind(texture)
      for (var i = 0; i < 6; ++i) {
        for (var j = 0; texture.mipmask >> j; ++j) {
          gl.texImage2D(
            GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + i,
            j,
            texture.format,
            radius >> j,
            radius >> j,
            0,
            texture.format,
            texture.type,
            null)
        }
      }
      tempRestore()

      if (config.profile) {
        texture.stats.size = getTextureSize(
          texture.internalformat,
          texture.type,
          reglTextureCube.width,
          reglTextureCube.height,
          false,
          true)
      }

      return reglTextureCube
    }

    reglTextureCube(a0, a1, a2, a3, a4, a5)

    reglTextureCube.subimage = subimage
    reglTextureCube.resize = resize
    reglTextureCube._reglType = 'textureCube'
    reglTextureCube._texture = texture
    if (config.profile) {
      reglTextureCube.stats = texture.stats
    }
    reglTextureCube.destroy = function () {
      texture.decRef()
    }

    return reglTextureCube
  }

  // Called when regl is destroyed
  function destroyTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      gl.activeTexture(GL_TEXTURE0$1 + i)
      gl.bindTexture(GL_TEXTURE_2D$1, null)
      textureUnits[i] = null
    }
    values(textureSet).forEach(destroy)

    stats.cubeCount = 0
    stats.textureCount = 0
  }

  if (config.profile) {
    stats.getTotalTextureSize = function () {
      var total = 0
      Object.keys(textureSet).forEach(function (key) {
        total += textureSet[key].stats.size
      })
      return total
    }
  }

  function restoreTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      var tex = textureUnits[i]
      if (tex) {
        tex.bindCount = 0
        tex.unit = -1
        textureUnits[i] = null
      }
    }

    values(textureSet).forEach(function (texture) {
      texture.texture = gl.createTexture()
      gl.bindTexture(texture.target, texture.texture)
      for (var i = 0; i < 32; ++i) {
        if ((texture.mipmask & (1 << i)) === 0) {
          continue
        }
        if (texture.target === GL_TEXTURE_2D$1) {
          gl.texImage2D(GL_TEXTURE_2D$1,
            i,
            texture.internalformat,
            texture.width >> i,
            texture.height >> i,
            0,
            texture.internalformat,
            texture.type,
            null)
        } else {
          for (var j = 0; j < 6; ++j) {
            gl.texImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X$1 + j,
              i,
              texture.internalformat,
              texture.width >> i,
              texture.height >> i,
              0,
              texture.internalformat,
              texture.type,
              null)
          }
        }
      }
      setTexInfo(texture.texInfo, texture.target)
    })
  }

  function refreshTextures () {
    for (var i = 0; i < numTexUnits; ++i) {
      var tex = textureUnits[i]
      if (tex) {
        tex.bindCount = 0
        tex.unit = -1
        textureUnits[i] = null
      }
      gl.activeTexture(GL_TEXTURE0$1 + i)
      gl.bindTexture(GL_TEXTURE_2D$1, null)
      gl.bindTexture(GL_TEXTURE_CUBE_MAP$1, null)
    }
  }

  return {
    create2D: createTexture2D,
    createCube: createTextureCube,
    clear: destroyTextures,
    getTexture: function (wrapper) {
      return null
    },
    restore: restoreTextures,
    refresh: refreshTextures
  }
}

var GL_RENDERBUFFER = 0x8D41

var GL_RGBA4$1 = 0x8056
var GL_RGB5_A1$1 = 0x8057
var GL_RGB565$1 = 0x8D62
var GL_DEPTH_COMPONENT16 = 0x81A5
var GL_STENCIL_INDEX8 = 0x8D48
var GL_DEPTH_STENCIL$1 = 0x84F9

var GL_SRGB8_ALPHA8_EXT = 0x8C43

var GL_RGBA32F_EXT = 0x8814

var GL_RGBA16F_EXT = 0x881A
var GL_RGB16F_EXT = 0x881B

var FORMAT_SIZES = []

FORMAT_SIZES[GL_RGBA4$1] = 2
FORMAT_SIZES[GL_RGB5_A1$1] = 2
FORMAT_SIZES[GL_RGB565$1] = 2

FORMAT_SIZES[GL_DEPTH_COMPONENT16] = 2
FORMAT_SIZES[GL_STENCIL_INDEX8] = 1
FORMAT_SIZES[GL_DEPTH_STENCIL$1] = 4

FORMAT_SIZES[GL_SRGB8_ALPHA8_EXT] = 4
FORMAT_SIZES[GL_RGBA32F_EXT] = 16
FORMAT_SIZES[GL_RGBA16F_EXT] = 8
FORMAT_SIZES[GL_RGB16F_EXT] = 6

function getRenderbufferSize (format, width, height) {
  return FORMAT_SIZES[format] * width * height
}

var wrapRenderbuffers = function (gl, extensions, limits, stats, config) {
  var formatTypes = {
    'rgba4': GL_RGBA4$1,
    'rgb565': GL_RGB565$1,
    'rgb5 a1': GL_RGB5_A1$1,
    'depth': GL_DEPTH_COMPONENT16,
    'stencil': GL_STENCIL_INDEX8,
    'depth stencil': GL_DEPTH_STENCIL$1
  }

  if (extensions.ext_srgb) {
    formatTypes['srgba'] = GL_SRGB8_ALPHA8_EXT
  }

  if (extensions.ext_color_buffer_half_float) {
    formatTypes['rgba16f'] = GL_RGBA16F_EXT
    formatTypes['rgb16f'] = GL_RGB16F_EXT
  }

  if (extensions.webgl_color_buffer_float) {
    formatTypes['rgba32f'] = GL_RGBA32F_EXT
  }

  var formatTypesInvert = []
  Object.keys(formatTypes).forEach(function (key) {
    var val = formatTypes[key]
    formatTypesInvert[val] = key
  })

  var renderbufferCount = 0
  var renderbufferSet = {}

  function REGLRenderbuffer (renderbuffer) {
    this.id = renderbufferCount++
    this.refCount = 1

    this.renderbuffer = renderbuffer

    this.format = GL_RGBA4$1
    this.width = 0
    this.height = 0

    if (config.profile) {
      this.stats = { size: 0 }
    }
  }

  REGLRenderbuffer.prototype.decRef = function () {
    if (--this.refCount <= 0) {
      destroy(this)
    }
  }

  function destroy (rb) {
    var handle = rb.renderbuffer
    check$1(handle, 'must not double destroy renderbuffer')
    gl.bindRenderbuffer(GL_RENDERBUFFER, null)
    gl.deleteRenderbuffer(handle)
    rb.renderbuffer = null
    rb.refCount = 0
    delete renderbufferSet[rb.id]
    stats.renderbufferCount--
  }

  function createRenderbuffer (a, b) {
    var renderbuffer = new REGLRenderbuffer(gl.createRenderbuffer())
    renderbufferSet[renderbuffer.id] = renderbuffer
    stats.renderbufferCount++

    function reglRenderbuffer (a, b) {
      var w = 0
      var h = 0
      var format = GL_RGBA4$1

      if (typeof a === 'object' && a) {
        var options = a
        if ('shape' in options) {
          var shape = options.shape
          check$1(Array.isArray(shape) && shape.length >= 2,
            'invalid renderbuffer shape')
          w = shape[0] | 0
          h = shape[1] | 0
        } else {
          if ('radius' in options) {
            w = h = options.radius | 0
          }
          if ('width' in options) {
            w = options.width | 0
          }
          if ('height' in options) {
            h = options.height | 0
          }
        }
        if ('format' in options) {
          check$1.parameter(options.format, formatTypes,
            'invalid renderbuffer format')
          format = formatTypes[options.format]
        }
      } else if (typeof a === 'number') {
        w = a | 0
        if (typeof b === 'number') {
          h = b | 0
        } else {
          h = w
        }
      } else if (!a) {
        w = h = 1
      } else {
        check$1.raise('invalid arguments to renderbuffer constructor')
      }

      // check shape
      check$1(
        w > 0 && h > 0 &&
        w <= limits.maxRenderbufferSize && h <= limits.maxRenderbufferSize,
        'invalid renderbuffer size')

      if (w === renderbuffer.width &&
          h === renderbuffer.height &&
          format === renderbuffer.format) {
        return
      }

      reglRenderbuffer.width = renderbuffer.width = w
      reglRenderbuffer.height = renderbuffer.height = h
      renderbuffer.format = format

      gl.bindRenderbuffer(GL_RENDERBUFFER, renderbuffer.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, format, w, h)

      check$1(
        gl.getError() === 0,
        'invalid render buffer format')

      if (config.profile) {
        renderbuffer.stats.size = getRenderbufferSize(renderbuffer.format, renderbuffer.width, renderbuffer.height)
      }
      reglRenderbuffer.format = formatTypesInvert[renderbuffer.format]

      return reglRenderbuffer
    }

    function resize (w_, h_) {
      var w = w_ | 0
      var h = (h_ | 0) || w

      if (w === renderbuffer.width && h === renderbuffer.height) {
        return reglRenderbuffer
      }

      // check shape
      check$1(
        w > 0 && h > 0 &&
        w <= limits.maxRenderbufferSize && h <= limits.maxRenderbufferSize,
        'invalid renderbuffer size')

      reglRenderbuffer.width = renderbuffer.width = w
      reglRenderbuffer.height = renderbuffer.height = h

      gl.bindRenderbuffer(GL_RENDERBUFFER, renderbuffer.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, renderbuffer.format, w, h)

      check$1(
        gl.getError() === 0,
        'invalid render buffer format')

      // also, recompute size.
      if (config.profile) {
        renderbuffer.stats.size = getRenderbufferSize(
          renderbuffer.format, renderbuffer.width, renderbuffer.height)
      }

      return reglRenderbuffer
    }

    reglRenderbuffer(a, b)

    reglRenderbuffer.resize = resize
    reglRenderbuffer._reglType = 'renderbuffer'
    reglRenderbuffer._renderbuffer = renderbuffer
    if (config.profile) {
      reglRenderbuffer.stats = renderbuffer.stats
    }
    reglRenderbuffer.destroy = function () {
      renderbuffer.decRef()
    }

    return reglRenderbuffer
  }

  if (config.profile) {
    stats.getTotalRenderbufferSize = function () {
      var total = 0
      Object.keys(renderbufferSet).forEach(function (key) {
        total += renderbufferSet[key].stats.size
      })
      return total
    }
  }

  function restoreRenderbuffers () {
    values(renderbufferSet).forEach(function (rb) {
      rb.renderbuffer = gl.createRenderbuffer()
      gl.bindRenderbuffer(GL_RENDERBUFFER, rb.renderbuffer)
      gl.renderbufferStorage(GL_RENDERBUFFER, rb.format, rb.width, rb.height)
    })
    gl.bindRenderbuffer(GL_RENDERBUFFER, null)
  }

  return {
    create: createRenderbuffer,
    clear: function () {
      values(renderbufferSet).forEach(destroy)
    },
    restore: restoreRenderbuffers
  }
}

// We store these constants so that the minifier can inline them
var GL_FRAMEBUFFER$1 = 0x8D40
var GL_RENDERBUFFER$1 = 0x8D41

var GL_TEXTURE_2D$2 = 0x0DE1
var GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 = 0x8515

var GL_COLOR_ATTACHMENT0$1 = 0x8CE0
var GL_DEPTH_ATTACHMENT = 0x8D00
var GL_STENCIL_ATTACHMENT = 0x8D20
var GL_DEPTH_STENCIL_ATTACHMENT = 0x821A

var GL_FRAMEBUFFER_COMPLETE$1 = 0x8CD5
var GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT = 0x8CD6
var GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT = 0x8CD7
var GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS = 0x8CD9
var GL_FRAMEBUFFER_UNSUPPORTED = 0x8CDD

var GL_HALF_FLOAT_OES$2 = 0x8D61
var GL_UNSIGNED_BYTE$6 = 0x1401
var GL_FLOAT$5 = 0x1406

var GL_RGB$1 = 0x1907
var GL_RGBA$2 = 0x1908

var GL_DEPTH_COMPONENT$1 = 0x1902

var colorTextureFormatEnums = [
  GL_RGB$1,
  GL_RGBA$2
]

// for every texture format, store
// the number of channels
var textureFormatChannels = []
textureFormatChannels[GL_RGBA$2] = 4
textureFormatChannels[GL_RGB$1] = 3

// for every texture type, store
// the size in bytes.
var textureTypeSizes = []
textureTypeSizes[GL_UNSIGNED_BYTE$6] = 1
textureTypeSizes[GL_FLOAT$5] = 4
textureTypeSizes[GL_HALF_FLOAT_OES$2] = 2

var GL_RGBA4$2 = 0x8056
var GL_RGB5_A1$2 = 0x8057
var GL_RGB565$2 = 0x8D62
var GL_DEPTH_COMPONENT16$1 = 0x81A5
var GL_STENCIL_INDEX8$1 = 0x8D48
var GL_DEPTH_STENCIL$2 = 0x84F9

var GL_SRGB8_ALPHA8_EXT$1 = 0x8C43

var GL_RGBA32F_EXT$1 = 0x8814

var GL_RGBA16F_EXT$1 = 0x881A
var GL_RGB16F_EXT$1 = 0x881B

var colorRenderbufferFormatEnums = [
  GL_RGBA4$2,
  GL_RGB5_A1$2,
  GL_RGB565$2,
  GL_SRGB8_ALPHA8_EXT$1,
  GL_RGBA16F_EXT$1,
  GL_RGB16F_EXT$1,
  GL_RGBA32F_EXT$1
]

var statusCode = {}
statusCode[GL_FRAMEBUFFER_COMPLETE$1] = 'complete'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT] = 'incomplete attachment'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS] = 'incomplete dimensions'
statusCode[GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT] = 'incomplete, missing attachment'
statusCode[GL_FRAMEBUFFER_UNSUPPORTED] = 'unsupported'

function wrapFBOState (
  gl,
  extensions,
  limits,
  textureState,
  renderbufferState,
  stats) {
  var framebufferState = {
    cur: null,
    next: null,
    dirty: false,
    setFBO: null
  }

  var colorTextureFormats = ['rgba']
  var colorRenderbufferFormats = ['rgba4', 'rgb565', 'rgb5 a1']

  if (extensions.ext_srgb) {
    colorRenderbufferFormats.push('srgba')
  }

  if (extensions.ext_color_buffer_half_float) {
    colorRenderbufferFormats.push('rgba16f', 'rgb16f')
  }

  if (extensions.webgl_color_buffer_float) {
    colorRenderbufferFormats.push('rgba32f')
  }

  var colorTypes = ['uint8']
  if (extensions.oes_texture_half_float) {
    colorTypes.push('half float', 'float16')
  }
  if (extensions.oes_texture_float) {
    colorTypes.push('float', 'float32')
  }

  function FramebufferAttachment (target, texture, renderbuffer) {
    this.target = target
    this.texture = texture
    this.renderbuffer = renderbuffer

    var w = 0
    var h = 0
    if (texture) {
      w = texture.width
      h = texture.height
    } else if (renderbuffer) {
      w = renderbuffer.width
      h = renderbuffer.height
    }
    this.width = w
    this.height = h
  }

  function decRef (attachment) {
    if (attachment) {
      if (attachment.texture) {
        attachment.texture._texture.decRef()
      }
      if (attachment.renderbuffer) {
        attachment.renderbuffer._renderbuffer.decRef()
      }
    }
  }

  function incRefAndCheckShape (attachment, width, height) {
    if (!attachment) {
      return
    }
    if (attachment.texture) {
      var texture = attachment.texture._texture
      var tw = Math.max(1, texture.width)
      var th = Math.max(1, texture.height)
      check$1(tw === width && th === height,
        'inconsistent width/height for supplied texture')
      texture.refCount += 1
    } else {
      var renderbuffer = attachment.renderbuffer._renderbuffer
      check$1(
        renderbuffer.width === width && renderbuffer.height === height,
        'inconsistent width/height for renderbuffer')
      renderbuffer.refCount += 1
    }
  }

  function attach (location, attachment) {
    if (attachment) {
      if (attachment.texture) {
        gl.framebufferTexture2D(
          GL_FRAMEBUFFER$1,
          location,
          attachment.target,
          attachment.texture._texture.texture,
          0)
      } else {
        gl.framebufferRenderbuffer(
          GL_FRAMEBUFFER$1,
          location,
          GL_RENDERBUFFER$1,
          attachment.renderbuffer._renderbuffer.renderbuffer)
      }
    }
  }

  function parseAttachment (attachment) {
    var target = GL_TEXTURE_2D$2
    var texture = null
    var renderbuffer = null

    var data = attachment
    if (typeof attachment === 'object') {
      data = attachment.data
      if ('target' in attachment) {
        target = attachment.target | 0
      }
    }

    check$1.type(data, 'function', 'invalid attachment data')

    var type = data._reglType
    if (type === 'texture2d') {
      texture = data
      check$1(target === GL_TEXTURE_2D$2)
    } else if (type === 'textureCube') {
      texture = data
      check$1(
        target >= GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 &&
        target < GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 + 6,
        'invalid cube map target')
    } else if (type === 'renderbuffer') {
      renderbuffer = data
      target = GL_RENDERBUFFER$1
    } else {
      check$1.raise('invalid regl object for attachment')
    }

    return new FramebufferAttachment(target, texture, renderbuffer)
  }

  function allocAttachment (
    width,
    height,
    isTexture,
    format,
    type) {
    if (isTexture) {
      var texture = textureState.create2D({
        width: width,
        height: height,
        format: format,
        type: type
      })
      texture._texture.refCount = 0
      return new FramebufferAttachment(GL_TEXTURE_2D$2, texture, null)
    } else {
      var rb = renderbufferState.create({
        width: width,
        height: height,
        format: format
      })
      rb._renderbuffer.refCount = 0
      return new FramebufferAttachment(GL_RENDERBUFFER$1, null, rb)
    }
  }

  function unwrapAttachment (attachment) {
    return attachment && (attachment.texture || attachment.renderbuffer)
  }

  function resizeAttachment (attachment, w, h) {
    if (attachment) {
      if (attachment.texture) {
        attachment.texture.resize(w, h)
      } else if (attachment.renderbuffer) {
        attachment.renderbuffer.resize(w, h)
      }
      attachment.width = w
      attachment.height = h
    }
  }

  var framebufferCount = 0
  var framebufferSet = {}

  function REGLFramebuffer () {
    this.id = framebufferCount++
    framebufferSet[this.id] = this

    this.framebuffer = gl.createFramebuffer()
    this.width = 0
    this.height = 0

    this.colorAttachments = []
    this.depthAttachment = null
    this.stencilAttachment = null
    this.depthStencilAttachment = null
  }

  function decFBORefs (framebuffer) {
    framebuffer.colorAttachments.forEach(decRef)
    decRef(framebuffer.depthAttachment)
    decRef(framebuffer.stencilAttachment)
    decRef(framebuffer.depthStencilAttachment)
  }

  function destroy (framebuffer) {
    var handle = framebuffer.framebuffer
    check$1(handle, 'must not double destroy framebuffer')
    gl.deleteFramebuffer(handle)
    framebuffer.framebuffer = null
    stats.framebufferCount--
    delete framebufferSet[framebuffer.id]
  }

  function updateFramebuffer (framebuffer) {
    var i

    gl.bindFramebuffer(GL_FRAMEBUFFER$1, framebuffer.framebuffer)
    var colorAttachments = framebuffer.colorAttachments
    for (i = 0; i < colorAttachments.length; ++i) {
      attach(GL_COLOR_ATTACHMENT0$1 + i, colorAttachments[i])
    }
    for (i = colorAttachments.length; i < limits.maxColorAttachments; ++i) {
      gl.framebufferTexture2D(
        GL_FRAMEBUFFER$1,
        GL_COLOR_ATTACHMENT0$1 + i,
        GL_TEXTURE_2D$2,
        null,
        0)
    }

    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_DEPTH_STENCIL_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)
    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_DEPTH_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)
    gl.framebufferTexture2D(
      GL_FRAMEBUFFER$1,
      GL_STENCIL_ATTACHMENT,
      GL_TEXTURE_2D$2,
      null,
      0)

    attach(GL_DEPTH_ATTACHMENT, framebuffer.depthAttachment)
    attach(GL_STENCIL_ATTACHMENT, framebuffer.stencilAttachment)
    attach(GL_DEPTH_STENCIL_ATTACHMENT, framebuffer.depthStencilAttachment)

    // Check status code
    var status = gl.checkFramebufferStatus(GL_FRAMEBUFFER$1)
    if (!gl.isContextLost() && status !== GL_FRAMEBUFFER_COMPLETE$1) {
      check$1.raise('framebuffer configuration not supported, status = ' +
        statusCode[status])
    }

    gl.bindFramebuffer(GL_FRAMEBUFFER$1, framebufferState.next ? framebufferState.next.framebuffer : null)
    framebufferState.cur = framebufferState.next

    // FIXME: Clear error code here.  This is a work around for a bug in
    // headless-gl
    gl.getError()
  }

  function createFBO (a0, a1) {
    var framebuffer = new REGLFramebuffer()
    stats.framebufferCount++

    function reglFramebuffer (a, b) {
      var i

      check$1(framebufferState.next !== framebuffer,
        'can not update framebuffer which is currently in use')

      var width = 0
      var height = 0

      var needsDepth = true
      var needsStencil = true

      var colorBuffer = null
      var colorTexture = true
      var colorFormat = 'rgba'
      var colorType = 'uint8'
      var colorCount = 1

      var depthBuffer = null
      var stencilBuffer = null
      var depthStencilBuffer = null
      var depthStencilTexture = false

      if (typeof a === 'number') {
        width = a | 0
        height = (b | 0) || width
      } else if (!a) {
        width = height = 1
      } else {
        check$1.type(a, 'object', 'invalid arguments for framebuffer')
        var options = a

        if ('shape' in options) {
          var shape = options.shape
          check$1(Array.isArray(shape) && shape.length >= 2,
            'invalid shape for framebuffer')
          width = shape[0]
          height = shape[1]
        } else {
          if ('radius' in options) {
            width = height = options.radius
          }
          if ('width' in options) {
            width = options.width
          }
          if ('height' in options) {
            height = options.height
          }
        }

        if ('color' in options ||
            'colors' in options) {
          colorBuffer =
            options.color ||
            options.colors
          if (Array.isArray(colorBuffer)) {
            check$1(
              colorBuffer.length === 1 || extensions.webgl_draw_buffers,
              'multiple render targets not supported')
          }
        }

        if (!colorBuffer) {
          if ('colorCount' in options) {
            colorCount = options.colorCount | 0
            check$1(colorCount > 0, 'invalid color buffer count')
          }

          if ('colorTexture' in options) {
            colorTexture = !!options.colorTexture
            colorFormat = 'rgba4'
          }

          if ('colorType' in options) {
            colorType = options.colorType
            if (!colorTexture) {
              if (colorType === 'half float' || colorType === 'float16') {
                check$1(extensions.ext_color_buffer_half_float,
                  'you must enable EXT_color_buffer_half_float to use 16-bit render buffers')
                colorFormat = 'rgba16f'
              } else if (colorType === 'float' || colorType === 'float32') {
                check$1(extensions.webgl_color_buffer_float,
                  'you must enable WEBGL_color_buffer_float in order to use 32-bit floating point renderbuffers')
                colorFormat = 'rgba32f'
              }
            } else {
              check$1(extensions.oes_texture_float ||
                !(colorType === 'float' || colorType === 'float32'),
              'you must enable OES_texture_float in order to use floating point framebuffer objects')
              check$1(extensions.oes_texture_half_float ||
                !(colorType === 'half float' || colorType === 'float16'),
              'you must enable OES_texture_half_float in order to use 16-bit floating point framebuffer objects')
            }
            check$1.oneOf(colorType, colorTypes, 'invalid color type')
          }

          if ('colorFormat' in options) {
            colorFormat = options.colorFormat
            if (colorTextureFormats.indexOf(colorFormat) >= 0) {
              colorTexture = true
            } else if (colorRenderbufferFormats.indexOf(colorFormat) >= 0) {
              colorTexture = false
            } else {
              check$1.optional(function () {
                if (colorTexture) {
                  check$1.oneOf(
                    options.colorFormat, colorTextureFormats,
                    'invalid color format for texture')
                } else {
                  check$1.oneOf(
                    options.colorFormat, colorRenderbufferFormats,
                    'invalid color format for renderbuffer')
                }
              })
            }
          }
        }

        if ('depthTexture' in options || 'depthStencilTexture' in options) {
          depthStencilTexture = !!(options.depthTexture ||
            options.depthStencilTexture)
          check$1(!depthStencilTexture || extensions.webgl_depth_texture,
            'webgl_depth_texture extension not supported')
        }

        if ('depth' in options) {
          if (typeof options.depth === 'boolean') {
            needsDepth = options.depth
          } else {
            depthBuffer = options.depth
            needsStencil = false
          }
        }

        if ('stencil' in options) {
          if (typeof options.stencil === 'boolean') {
            needsStencil = options.stencil
          } else {
            stencilBuffer = options.stencil
            needsDepth = false
          }
        }

        if ('depthStencil' in options) {
          if (typeof options.depthStencil === 'boolean') {
            needsDepth = needsStencil = options.depthStencil
          } else {
            depthStencilBuffer = options.depthStencil
            needsDepth = false
            needsStencil = false
          }
        }
      }

      // parse attachments
      var colorAttachments = null
      var depthAttachment = null
      var stencilAttachment = null
      var depthStencilAttachment = null

      // Set up color attachments
      if (Array.isArray(colorBuffer)) {
        colorAttachments = colorBuffer.map(parseAttachment)
      } else if (colorBuffer) {
        colorAttachments = [parseAttachment(colorBuffer)]
      } else {
        colorAttachments = new Array(colorCount)
        for (i = 0; i < colorCount; ++i) {
          colorAttachments[i] = allocAttachment(
            width,
            height,
            colorTexture,
            colorFormat,
            colorType)
        }
      }

      check$1(extensions.webgl_draw_buffers || colorAttachments.length <= 1,
        'you must enable the WEBGL_draw_buffers extension in order to use multiple color buffers.')
      check$1(colorAttachments.length <= limits.maxColorAttachments,
        'too many color attachments, not supported')

      width = width || colorAttachments[0].width
      height = height || colorAttachments[0].height

      if (depthBuffer) {
        depthAttachment = parseAttachment(depthBuffer)
      } else if (needsDepth && !needsStencil) {
        depthAttachment = allocAttachment(
          width,
          height,
          depthStencilTexture,
          'depth',
          'uint32')
      }

      if (stencilBuffer) {
        stencilAttachment = parseAttachment(stencilBuffer)
      } else if (needsStencil && !needsDepth) {
        stencilAttachment = allocAttachment(
          width,
          height,
          false,
          'stencil',
          'uint8')
      }

      if (depthStencilBuffer) {
        depthStencilAttachment = parseAttachment(depthStencilBuffer)
      } else if (!depthBuffer && !stencilBuffer && needsStencil && needsDepth) {
        depthStencilAttachment = allocAttachment(
          width,
          height,
          depthStencilTexture,
          'depth stencil',
          'depth stencil')
      }

      check$1(
        (!!depthBuffer) + (!!stencilBuffer) + (!!depthStencilBuffer) <= 1,
        'invalid framebuffer configuration, can specify exactly one depth/stencil attachment')

      var commonColorAttachmentSize = null

      for (i = 0; i < colorAttachments.length; ++i) {
        incRefAndCheckShape(colorAttachments[i], width, height)
        check$1(!colorAttachments[i] ||
          (colorAttachments[i].texture &&
            colorTextureFormatEnums.indexOf(colorAttachments[i].texture._texture.format) >= 0) ||
          (colorAttachments[i].renderbuffer &&
            colorRenderbufferFormatEnums.indexOf(colorAttachments[i].renderbuffer._renderbuffer.format) >= 0),
        'framebuffer color attachment ' + i + ' is invalid')

        if (colorAttachments[i] && colorAttachments[i].texture) {
          var colorAttachmentSize =
              textureFormatChannels[colorAttachments[i].texture._texture.format] *
              textureTypeSizes[colorAttachments[i].texture._texture.type]

          if (commonColorAttachmentSize === null) {
            commonColorAttachmentSize = colorAttachmentSize
          } else {
            // We need to make sure that all color attachments have the same number of bitplanes
            // (that is, the same numer of bits per pixel)
            // This is required by the GLES2.0 standard. See the beginning of Chapter 4 in that document.
            check$1(commonColorAttachmentSize === colorAttachmentSize,
              'all color attachments much have the same number of bits per pixel.')
          }
        }
      }
      incRefAndCheckShape(depthAttachment, width, height)
      check$1(!depthAttachment ||
        (depthAttachment.texture &&
          depthAttachment.texture._texture.format === GL_DEPTH_COMPONENT$1) ||
        (depthAttachment.renderbuffer &&
          depthAttachment.renderbuffer._renderbuffer.format === GL_DEPTH_COMPONENT16$1),
      'invalid depth attachment for framebuffer object')
      incRefAndCheckShape(stencilAttachment, width, height)
      check$1(!stencilAttachment ||
        (stencilAttachment.renderbuffer &&
          stencilAttachment.renderbuffer._renderbuffer.format === GL_STENCIL_INDEX8$1),
      'invalid stencil attachment for framebuffer object')
      incRefAndCheckShape(depthStencilAttachment, width, height)
      check$1(!depthStencilAttachment ||
        (depthStencilAttachment.texture &&
          depthStencilAttachment.texture._texture.format === GL_DEPTH_STENCIL$2) ||
        (depthStencilAttachment.renderbuffer &&
          depthStencilAttachment.renderbuffer._renderbuffer.format === GL_DEPTH_STENCIL$2),
      'invalid depth-stencil attachment for framebuffer object')

      // decrement references
      decFBORefs(framebuffer)

      framebuffer.width = width
      framebuffer.height = height

      framebuffer.colorAttachments = colorAttachments
      framebuffer.depthAttachment = depthAttachment
      framebuffer.stencilAttachment = stencilAttachment
      framebuffer.depthStencilAttachment = depthStencilAttachment

      reglFramebuffer.color = colorAttachments.map(unwrapAttachment)
      reglFramebuffer.depth = unwrapAttachment(depthAttachment)
      reglFramebuffer.stencil = unwrapAttachment(stencilAttachment)
      reglFramebuffer.depthStencil = unwrapAttachment(depthStencilAttachment)

      reglFramebuffer.width = framebuffer.width
      reglFramebuffer.height = framebuffer.height

      updateFramebuffer(framebuffer)

      return reglFramebuffer
    }

    function resize (w_, h_) {
      check$1(framebufferState.next !== framebuffer,
        'can not resize a framebuffer which is currently in use')

      var w = Math.max(w_ | 0, 1)
      var h = Math.max((h_ | 0) || w, 1)
      if (w === framebuffer.width && h === framebuffer.height) {
        return reglFramebuffer
      }

      // resize all buffers
      var colorAttachments = framebuffer.colorAttachments
      for (var i = 0; i < colorAttachments.length; ++i) {
        resizeAttachment(colorAttachments[i], w, h)
      }
      resizeAttachment(framebuffer.depthAttachment, w, h)
      resizeAttachment(framebuffer.stencilAttachment, w, h)
      resizeAttachment(framebuffer.depthStencilAttachment, w, h)

      framebuffer.width = reglFramebuffer.width = w
      framebuffer.height = reglFramebuffer.height = h

      updateFramebuffer(framebuffer)

      return reglFramebuffer
    }

    reglFramebuffer(a0, a1)

    return extend(reglFramebuffer, {
      resize: resize,
      _reglType: 'framebuffer',
      _framebuffer: framebuffer,
      destroy: function () {
        destroy(framebuffer)
        decFBORefs(framebuffer)
      },
      use: function (block) {
        framebufferState.setFBO({
          framebuffer: reglFramebuffer
        }, block)
      }
    })
  }

  function createCubeFBO (options) {
    var faces = Array(6)

    function reglFramebufferCube (a) {
      var i

      check$1(faces.indexOf(framebufferState.next) < 0,
        'can not update framebuffer which is currently in use')

      var params = {
        color: null
      }

      var radius = 0

      var colorBuffer = null
      var colorFormat = 'rgba'
      var colorType = 'uint8'
      var colorCount = 1

      if (typeof a === 'number') {
        radius = a | 0
      } else if (!a) {
        radius = 1
      } else {
        check$1.type(a, 'object', 'invalid arguments for framebuffer')
        var options = a

        if ('shape' in options) {
          var shape = options.shape
          check$1(
            Array.isArray(shape) && shape.length >= 2,
            'invalid shape for framebuffer')
          check$1(
            shape[0] === shape[1],
            'cube framebuffer must be square')
          radius = shape[0]
        } else {
          if ('radius' in options) {
            radius = options.radius | 0
          }
          if ('width' in options) {
            radius = options.width | 0
            if ('height' in options) {
              check$1(options.height === radius, 'must be square')
            }
          } else if ('height' in options) {
            radius = options.height | 0
          }
        }

        if ('color' in options ||
            'colors' in options) {
          colorBuffer =
            options.color ||
            options.colors
          if (Array.isArray(colorBuffer)) {
            check$1(
              colorBuffer.length === 1 || extensions.webgl_draw_buffers,
              'multiple render targets not supported')
          }
        }

        if (!colorBuffer) {
          if ('colorCount' in options) {
            colorCount = options.colorCount | 0
            check$1(colorCount > 0, 'invalid color buffer count')
          }

          if ('colorType' in options) {
            check$1.oneOf(
              options.colorType, colorTypes,
              'invalid color type')
            colorType = options.colorType
          }

          if ('colorFormat' in options) {
            colorFormat = options.colorFormat
            check$1.oneOf(
              options.colorFormat, colorTextureFormats,
              'invalid color format for texture')
          }
        }

        if ('depth' in options) {
          params.depth = options.depth
        }

        if ('stencil' in options) {
          params.stencil = options.stencil
        }

        if ('depthStencil' in options) {
          params.depthStencil = options.depthStencil
        }
      }

      var colorCubes
      if (colorBuffer) {
        if (Array.isArray(colorBuffer)) {
          colorCubes = []
          for (i = 0; i < colorBuffer.length; ++i) {
            colorCubes[i] = colorBuffer[i]
          }
        } else {
          colorCubes = [ colorBuffer ]
        }
      } else {
        colorCubes = Array(colorCount)
        var cubeMapParams = {
          radius: radius,
          format: colorFormat,
          type: colorType
        }
        for (i = 0; i < colorCount; ++i) {
          colorCubes[i] = textureState.createCube(cubeMapParams)
        }
      }

      // Check color cubes
      params.color = Array(colorCubes.length)
      for (i = 0; i < colorCubes.length; ++i) {
        var cube = colorCubes[i]
        check$1(
          typeof cube === 'function' && cube._reglType === 'textureCube',
          'invalid cube map')
        radius = radius || cube.width
        check$1(
          cube.width === radius && cube.height === radius,
          'invalid cube map shape')
        params.color[i] = {
          target: GL_TEXTURE_CUBE_MAP_POSITIVE_X$2,
          data: colorCubes[i]
        }
      }

      for (i = 0; i < 6; ++i) {
        for (var j = 0; j < colorCubes.length; ++j) {
          params.color[j].target = GL_TEXTURE_CUBE_MAP_POSITIVE_X$2 + i
        }
        // reuse depth-stencil attachments across all cube maps
        if (i > 0) {
          params.depth = faces[0].depth
          params.stencil = faces[0].stencil
          params.depthStencil = faces[0].depthStencil
        }
        if (faces[i]) {
          (faces[i])(params)
        } else {
          faces[i] = createFBO(params)
        }
      }

      return extend(reglFramebufferCube, {
        width: radius,
        height: radius,
        color: colorCubes
      })
    }

    function resize (radius_) {
      var i
      var radius = radius_ | 0
      check$1(radius > 0 && radius <= limits.maxCubeMapSize,
        'invalid radius for cube fbo')

      if (radius === reglFramebufferCube.width) {
        return reglFramebufferCube
      }

      var colors = reglFramebufferCube.color
      for (i = 0; i < colors.length; ++i) {
        colors[i].resize(radius)
      }

      for (i = 0; i < 6; ++i) {
        faces[i].resize(radius)
      }

      reglFramebufferCube.width = reglFramebufferCube.height = radius

      return reglFramebufferCube
    }

    reglFramebufferCube(options)

    return extend(reglFramebufferCube, {
      faces: faces,
      resize: resize,
      _reglType: 'framebufferCube',
      destroy: function () {
        faces.forEach(function (f) {
          f.destroy()
        })
      }
    })
  }

  function restoreFramebuffers () {
    framebufferState.cur = null
    framebufferState.next = null
    framebufferState.dirty = true
    values(framebufferSet).forEach(function (fb) {
      fb.framebuffer = gl.createFramebuffer()
      updateFramebuffer(fb)
    })
  }

  return extend(framebufferState, {
    getFramebuffer: function (object) {
      if (typeof object === 'function' && object._reglType === 'framebuffer') {
        var fbo = object._framebuffer
        if (fbo instanceof REGLFramebuffer) {
          return fbo
        }
      }
      return null
    },
    create: createFBO,
    createCube: createCubeFBO,
    clear: function () {
      values(framebufferSet).forEach(destroy)
    },
    restore: restoreFramebuffers
  })
}

var GL_FLOAT$6 = 5126
var GL_ARRAY_BUFFER$1 = 34962
var GL_ELEMENT_ARRAY_BUFFER$1 = 34963

var VAO_OPTIONS = [
  'attributes',
  'elements',
  'offset',
  'count',
  'primitive',
  'instances'
]

function AttributeRecord () {
  this.state = 0

  this.x = 0.0
  this.y = 0.0
  this.z = 0.0
  this.w = 0.0

  this.buffer = null
  this.size = 0
  this.normalized = false
  this.type = GL_FLOAT$6
  this.offset = 0
  this.stride = 0
  this.divisor = 0
}

function wrapAttributeState (
  gl,
  extensions,
  limits,
  stats,
  bufferState,
  elementState,
  drawState) {
  var NUM_ATTRIBUTES = limits.maxAttributes
  var attributeBindings = new Array(NUM_ATTRIBUTES)
  for (var i = 0; i < NUM_ATTRIBUTES; ++i) {
    attributeBindings[i] = new AttributeRecord()
  }
  var vaoCount = 0
  var vaoSet = {}

  var state = {
    Record: AttributeRecord,
    scope: {},
    state: attributeBindings,
    currentVAO: null,
    targetVAO: null,
    restore: extVAO() ? restoreVAO : function () {},
    createVAO: createVAO,
    getVAO: getVAO,
    destroyBuffer: destroyBuffer,
    setVAO: extVAO() ? setVAOEXT : setVAOEmulated,
    clear: extVAO() ? destroyVAOEXT : function () {}
  }

  function destroyBuffer (buffer) {
    for (var i = 0; i < attributeBindings.length; ++i) {
      var record = attributeBindings[i]
      if (record.buffer === buffer) {
        gl.disableVertexAttribArray(i)
        record.buffer = null
      }
    }
  }

  function extVAO () {
    return extensions.oes_vertex_array_object
  }

  function extInstanced () {
    return extensions.angle_instanced_arrays
  }

  function getVAO (vao) {
    if (typeof vao === 'function' && vao._vao) {
      return vao._vao
    }
    return null
  }

  function setVAOEXT (vao) {
    if (vao === state.currentVAO) {
      return
    }
    var ext = extVAO()
    if (vao) {
      ext.bindVertexArrayOES(vao.vao)
    } else {
      ext.bindVertexArrayOES(null)
    }
    state.currentVAO = vao
  }

  function setVAOEmulated (vao) {
    if (vao === state.currentVAO) {
      return
    }
    if (vao) {
      vao.bindAttrs()
    } else {
      var exti = extInstanced()
      for (var i = 0; i < attributeBindings.length; ++i) {
        var binding = attributeBindings[i]
        if (binding.buffer) {
          gl.enableVertexAttribArray(i)
          binding.buffer.bind()
          gl.vertexAttribPointer(i, binding.size, binding.type, binding.normalized, binding.stride, binding.offfset)
          if (exti && binding.divisor) {
            exti.vertexAttribDivisorANGLE(i, binding.divisor)
          }
        } else {
          gl.disableVertexAttribArray(i)
          gl.vertexAttrib4f(i, binding.x, binding.y, binding.z, binding.w)
        }
      }
      if (drawState.elements) {
        gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, drawState.elements.buffer.buffer)
      } else {
        gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, null)
      }
    }
    state.currentVAO = vao
  }

  function destroyVAOEXT () {
    values(vaoSet).forEach(function (vao) {
      vao.destroy()
    })
  }

  function REGLVAO () {
    this.id = ++vaoCount
    this.attributes = []
    this.elements = null
    this.ownsElements = false
    this.count = 0
    this.offset = 0
    this.instances = -1
    this.primitive = 4
    var extension = extVAO()
    if (extension) {
      this.vao = extension.createVertexArrayOES()
    } else {
      this.vao = null
    }
    vaoSet[this.id] = this
    this.buffers = []
  }

  REGLVAO.prototype.bindAttrs = function () {
    var exti = extInstanced()
    var attributes = this.attributes
    for (var i = 0; i < attributes.length; ++i) {
      var attr = attributes[i]
      if (attr.buffer) {
        gl.enableVertexAttribArray(i)
        gl.bindBuffer(GL_ARRAY_BUFFER$1, attr.buffer.buffer)
        gl.vertexAttribPointer(i, attr.size, attr.type, attr.normalized, attr.stride, attr.offset)
        if (exti && attr.divisor) {
          exti.vertexAttribDivisorANGLE(i, attr.divisor)
        }
      } else {
        gl.disableVertexAttribArray(i)
        gl.vertexAttrib4f(i, attr.x, attr.y, attr.z, attr.w)
      }
    }
    for (var j = attributes.length; j < NUM_ATTRIBUTES; ++j) {
      gl.disableVertexAttribArray(j)
    }
    var elements = elementState.getElements(this.elements)
    if (elements) {
      gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, elements.buffer.buffer)
    } else {
      gl.bindBuffer(GL_ELEMENT_ARRAY_BUFFER$1, null)
    }
  }

  REGLVAO.prototype.refresh = function () {
    var ext = extVAO()
    if (ext) {
      ext.bindVertexArrayOES(this.vao)
      this.bindAttrs()
      state.currentVAO = null
      ext.bindVertexArrayOES(null)
    }
  }

  REGLVAO.prototype.destroy = function () {
    if (this.vao) {
      var extension = extVAO()
      if (this === state.currentVAO) {
        state.currentVAO = null
        extension.bindVertexArrayOES(null)
      }
      extension.deleteVertexArrayOES(this.vao)
      this.vao = null
    }
    if (this.ownsElements) {
      this.elements.destroy()
      this.elements = null
      this.ownsElements = false
    }
    if (vaoSet[this.id]) {
      delete vaoSet[this.id]
      stats.vaoCount -= 1
    }
  }

  function restoreVAO () {
    var ext = extVAO()
    if (ext) {
      values(vaoSet).forEach(function (vao) {
        vao.refresh()
      })
    }
  }

  function createVAO (_attr) {
    var vao = new REGLVAO()
    stats.vaoCount += 1

    function updateVAO (options) {
      var attributes
      if (Array.isArray(options)) {
        attributes = options
        if (vao.elements && vao.ownsElements) {
          vao.elements.destroy()
        }
        vao.elements = null
        vao.ownsElements = false
        vao.offset = 0
        vao.count = 0
        vao.instances = -1
        vao.primitive = 4
      } else {
        check$1(typeof options === 'object', 'invalid arguments for create vao')
        check$1('attributes' in options, 'must specify attributes for vao')
        if (options.elements) {
          var elements = options.elements
          if (vao.ownsElements) {
            if (typeof elements === 'function' && elements._reglType === 'elements') {
              vao.elements.destroy()
              vao.ownsElements = false
            } else {
              vao.elements(elements)
              vao.ownsElements = false
            }
          } else if (elementState.getElements(options.elements)) {
            vao.elements = options.elements
            vao.ownsElements = false
          } else {
            vao.elements = elementState.create(options.elements)
            vao.ownsElements = true
          }
        } else {
          vao.elements = null
          vao.ownsElements = false
        }
        attributes = options.attributes

        // set default vao
        vao.offset = 0
        vao.count = -1
        vao.instances = -1
        vao.primitive = 4

        // copy element properties
        if (vao.elements) {
          vao.count = vao.elements._elements.vertCount
          vao.primitive = vao.elements._elements.primType
        }

        if ('offset' in options) {
          vao.offset = options.offset | 0
        }
        if ('count' in options) {
          vao.count = options.count | 0
        }
        if ('instances' in options) {
          vao.instances = options.instances | 0
        }
        if ('primitive' in options) {
          check$1(options.primitive in primTypes, 'bad primitive type: ' + options.primitive)
          vao.primitive = primTypes[options.primitive]
        }

        check$1.optional(() => {
          var keys = Object.keys(options)
          for (var i = 0; i < keys.length; ++i) {
            check$1(VAO_OPTIONS.indexOf(keys[i]) >= 0, 'invalid option for vao: "' + keys[i] + '" valid options are ' + VAO_OPTIONS)
          }
        })
        check$1(Array.isArray(attributes), 'attributes must be an array')
      }

      check$1(attributes.length < NUM_ATTRIBUTES, 'too many attributes')
      check$1(attributes.length > 0, 'must specify at least one attribute')

      var bufUpdated = {}
      var nattributes = vao.attributes
      nattributes.length = attributes.length
      for (var i = 0; i < attributes.length; ++i) {
        var spec = attributes[i]
        var rec = nattributes[i] = new AttributeRecord()
        var data = spec.data || spec
        if (Array.isArray(data) || isTypedArray(data) || isNDArrayLike(data)) {
          var buf
          if (vao.buffers[i]) {
            buf = vao.buffers[i]
            if (isTypedArray(data) && buf._buffer.byteLength >= data.byteLength) {
              buf.subdata(data)
            } else {
              buf.destroy()
              vao.buffers[i] = null
            }
          }
          if (!vao.buffers[i]) {
            buf = vao.buffers[i] = bufferState.create(spec, GL_ARRAY_BUFFER$1, false, true)
          }
          rec.buffer = bufferState.getBuffer(buf)
          rec.size = rec.buffer.dimension | 0
          rec.normalized = false
          rec.type = rec.buffer.dtype
          rec.offset = 0
          rec.stride = 0
          rec.divisor = 0
          rec.state = 1
          bufUpdated[i] = 1
        } else if (bufferState.getBuffer(spec)) {
          rec.buffer = bufferState.getBuffer(spec)
          rec.size = rec.buffer.dimension | 0
          rec.normalized = false
          rec.type = rec.buffer.dtype
          rec.offset = 0
          rec.stride = 0
          rec.divisor = 0
          rec.state = 1
        } else if (bufferState.getBuffer(spec.buffer)) {
          rec.buffer = bufferState.getBuffer(spec.buffer)
          rec.size = ((+spec.size) || rec.buffer.dimension) | 0
          rec.normalized = !!spec.normalized || false
          if ('type' in spec) {
            check$1.parameter(spec.type, glTypes, 'invalid buffer type')
            rec.type = glTypes[spec.type]
          } else {
            rec.type = rec.buffer.dtype
          }
          rec.offset = (spec.offset || 0) | 0
          rec.stride = (spec.stride || 0) | 0
          rec.divisor = (spec.divisor || 0) | 0
          rec.state = 1

          check$1(rec.size >= 1 && rec.size <= 4, 'size must be between 1 and 4')
          check$1(rec.offset >= 0, 'invalid offset')
          check$1(rec.stride >= 0 && rec.stride <= 255, 'stride must be between 0 and 255')
          check$1(rec.divisor >= 0, 'divisor must be positive')
          check$1(!rec.divisor || !!extensions.angle_instanced_arrays, 'ANGLE_instanced_arrays must be enabled to use divisor')
        } else if ('x' in spec) {
          check$1(i > 0, 'first attribute must not be a constant')
          rec.x = +spec.x || 0
          rec.y = +spec.y || 0
          rec.z = +spec.z || 0
          rec.w = +spec.w || 0
          rec.state = 2
        } else {
          check$1(false, 'invalid attribute spec for location ' + i)
        }
      }

      // retire unused buffers
      for (var j = 0; j < vao.buffers.length; ++j) {
        if (!bufUpdated[j] && vao.buffers[j]) {
          vao.buffers[j].destroy()
          vao.buffers[j] = null
        }
      }

      vao.refresh()
      return updateVAO
    }

    updateVAO.destroy = function () {
      for (var j = 0; j < vao.buffers.length; ++j) {
        if (vao.buffers[j]) {
          vao.buffers[j].destroy()
        }
      }
      vao.buffers.length = 0

      if (vao.ownsElements) {
        vao.elements.destroy()
        vao.elements = null
        vao.ownsElements = false
      }

      vao.destroy()
    }

    updateVAO._vao = vao
    updateVAO._reglType = 'vao'

    return updateVAO(_attr)
  }

  return state
}

var GL_FRAGMENT_SHADER = 35632
var GL_VERTEX_SHADER = 35633

var GL_ACTIVE_UNIFORMS = 0x8B86
var GL_ACTIVE_ATTRIBUTES = 0x8B89

function wrapShaderState (gl, stringStore, stats, config) {
  // ===================================================
  // glsl compilation and linking
  // ===================================================
  var fragShaders = {}
  var vertShaders = {}

  function ActiveInfo (name, id, location, info) {
    this.name = name
    this.id = id
    this.location = location
    this.info = info
  }

  function insertActiveInfo (list, info) {
    for (var i = 0; i < list.length; ++i) {
      if (list[i].id === info.id) {
        list[i].location = info.location
        return
      }
    }
    list.push(info)
  }

  function getShader (type, id, command) {
    var cache = type === GL_FRAGMENT_SHADER ? fragShaders : vertShaders
    var shader = cache[id]

    if (!shader) {
      var source = stringStore.str(id)
      shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      check$1.shaderError(gl, shader, source, type, command)
      cache[id] = shader
    }

    return shader
  }

  // ===================================================
  // program linking
  // ===================================================
  var programCache = {}
  var programList = []

  var PROGRAM_COUNTER = 0

  function REGLProgram (fragId, vertId) {
    this.id = PROGRAM_COUNTER++
    this.fragId = fragId
    this.vertId = vertId
    this.program = null
    this.uniforms = []
    this.attributes = []
    this.refCount = 1

    if (config.profile) {
      this.stats = {
        uniformsCount: 0,
        attributesCount: 0
      }
    }
  }

  function linkProgram (desc, command, attributeLocations) {
    var i, info

    // -------------------------------
    // compile & link
    // -------------------------------
    var fragShader = getShader(GL_FRAGMENT_SHADER, desc.fragId)
    var vertShader = getShader(GL_VERTEX_SHADER, desc.vertId)

    var program = desc.program = gl.createProgram()
    gl.attachShader(program, fragShader)
    gl.attachShader(program, vertShader)
    if (attributeLocations) {
      for (i = 0; i < attributeLocations.length; ++i) {
        var binding = attributeLocations[i]
        gl.bindAttribLocation(program, binding[0], binding[1])
      }
    }

    gl.linkProgram(program)
    check$1.linkError(
      gl,
      program,
      stringStore.str(desc.fragId),
      stringStore.str(desc.vertId),
      command)

    // -------------------------------
    // grab uniforms
    // -------------------------------
    var numUniforms = gl.getProgramParameter(program, GL_ACTIVE_UNIFORMS)
    if (config.profile) {
      desc.stats.uniformsCount = numUniforms
    }
    var uniforms = desc.uniforms
    for (i = 0; i < numUniforms; ++i) {
      info = gl.getActiveUniform(program, i)
      if (info) {
        if (info.size > 1) {
          for (var j = 0; j < info.size; ++j) {
            var name = info.name.replace('[0]', '[' + j + ']')
            insertActiveInfo(uniforms, new ActiveInfo(
              name,
              stringStore.id(name),
              gl.getUniformLocation(program, name),
              info))
          }
        } else {
          insertActiveInfo(uniforms, new ActiveInfo(
            info.name,
            stringStore.id(info.name),
            gl.getUniformLocation(program, info.name),
            info))
        }
      }
    }

    // -------------------------------
    // grab attributes
    // -------------------------------
    var numAttributes = gl.getProgramParameter(program, GL_ACTIVE_ATTRIBUTES)
    if (config.profile) {
      desc.stats.attributesCount = numAttributes
    }

    var attributes = desc.attributes
    for (i = 0; i < numAttributes; ++i) {
      info = gl.getActiveAttrib(program, i)
      if (info) {
        insertActiveInfo(attributes, new ActiveInfo(
          info.name,
          stringStore.id(info.name),
          gl.getAttribLocation(program, info.name),
          info))
      }
    }
  }

  if (config.profile) {
    stats.getMaxUniformsCount = function () {
      var m = 0
      programList.forEach(function (desc) {
        if (desc.stats.uniformsCount > m) {
          m = desc.stats.uniformsCount
        }
      })
      return m
    }

    stats.getMaxAttributesCount = function () {
      var m = 0
      programList.forEach(function (desc) {
        if (desc.stats.attributesCount > m) {
          m = desc.stats.attributesCount
        }
      })
      return m
    }
  }

  function restoreShaders () {
    fragShaders = {}
    vertShaders = {}
    for (var i = 0; i < programList.length; ++i) {
      linkProgram(programList[i], null, programList[i].attributes.map(function (info) {
        return [info.location, info.name]
      }))
    }
  }

  return {
    clear: function () {
      var deleteShader = gl.deleteShader.bind(gl)
      values(fragShaders).forEach(deleteShader)
      fragShaders = {}
      values(vertShaders).forEach(deleteShader)
      vertShaders = {}

      programList.forEach(function (desc) {
        gl.deleteProgram(desc.program)
      })
      programList.length = 0
      programCache = {}

      stats.shaderCount = 0
    },

    program: function (vertId, fragId, command, attribLocations) {
      check$1.command(vertId >= 0, 'missing vertex shader', command)
      check$1.command(fragId >= 0, 'missing fragment shader', command)

      var cache = programCache[fragId]
      if (!cache) {
        cache = programCache[fragId] = {}
      }
      var prevProgram = cache[vertId]
      if (prevProgram) {
        prevProgram.refCount++
        if (!attribLocations) {
          return prevProgram
        }
      }
      var program = new REGLProgram(fragId, vertId)
      stats.shaderCount++
      linkProgram(program, command, attribLocations)
      if (!prevProgram) {
        cache[vertId] = program
      }
      programList.push(program)
      return extend(program, {
        destroy: function () {
          program.refCount--
          if (program.refCount <= 0) {
            gl.deleteProgram(program.program)
            var idx = programList.indexOf(program)
            programList.splice(idx, 1)
            stats.shaderCount--
          }
          // no program is linked to this vert anymore
          if (cache[program.vertId].refCount <= 0) {
            gl.deleteShader(vertShaders[program.vertId])
            delete vertShaders[program.vertId]
            delete programCache[program.fragId][program.vertId]
          }
          // no program is linked to this frag anymore
          if (!Object.keys(programCache[program.fragId]).length) {
            gl.deleteShader(fragShaders[program.fragId])
            delete fragShaders[program.fragId]
            delete programCache[program.fragId]
          }
        }
      })
    },

    restore: restoreShaders,

    shader: getShader,

    frag: -1,
    vert: -1
  }
}

var GL_RGBA$3 = 6408
var GL_UNSIGNED_BYTE$7 = 5121
var GL_PACK_ALIGNMENT = 0x0D05
var GL_FLOAT$7 = 0x1406 // 5126

function wrapReadPixels (
  gl,
  framebufferState,
  reglPoll,
  context,
  glAttributes,
  extensions,
  limits) {
  function readPixelsImpl (input) {
    var type
    if (framebufferState.next === null) {
      check$1(
        glAttributes.preserveDrawingBuffer,
        'you must create a webgl context with "preserveDrawingBuffer":true in order to read pixels from the drawing buffer')
      type = GL_UNSIGNED_BYTE$7
    } else {
      check$1(
        framebufferState.next.colorAttachments[0].texture !== null,
        'You cannot read from a renderbuffer')
      type = framebufferState.next.colorAttachments[0].texture._texture.type

      check$1.optional(function () {
        if (extensions.oes_texture_float) {
          check$1(
            type === GL_UNSIGNED_BYTE$7 || type === GL_FLOAT$7,
            'Reading from a framebuffer is only allowed for the types \'uint8\' and \'float\'')

          if (type === GL_FLOAT$7) {
            check$1(limits.readFloat, 'Reading \'float\' values is not permitted in your browser. For a fallback, please see: https://www.npmjs.com/package/glsl-read-float')
          }
        } else {
          check$1(
            type === GL_UNSIGNED_BYTE$7,
            'Reading from a framebuffer is only allowed for the type \'uint8\'')
        }
      })
    }

    var x = 0
    var y = 0
    var width = context.framebufferWidth
    var height = context.framebufferHeight
    var data = null

    if (isTypedArray(input)) {
      data = input
    } else if (input) {
      check$1.type(input, 'object', 'invalid arguments to regl.read()')
      x = input.x | 0
      y = input.y | 0
      check$1(
        x >= 0 && x < context.framebufferWidth,
        'invalid x offset for regl.read')
      check$1(
        y >= 0 && y < context.framebufferHeight,
        'invalid y offset for regl.read')
      width = (input.width || (context.framebufferWidth - x)) | 0
      height = (input.height || (context.framebufferHeight - y)) | 0
      data = input.data || null
    }

    // sanity check input.data
    if (data) {
      if (type === GL_UNSIGNED_BYTE$7) {
        check$1(
          data instanceof Uint8Array,
          'buffer must be \'Uint8Array\' when reading from a framebuffer of type \'uint8\'')
      } else if (type === GL_FLOAT$7) {
        check$1(
          data instanceof Float32Array,
          'buffer must be \'Float32Array\' when reading from a framebuffer of type \'float\'')
      }
    }

    check$1(
      width > 0 && width + x <= context.framebufferWidth,
      'invalid width for read pixels')
    check$1(
      height > 0 && height + y <= context.framebufferHeight,
      'invalid height for read pixels')

    // Update WebGL state
    reglPoll()

    // Compute size
    var size = width * height * 4

    // Allocate data
    if (!data) {
      if (type === GL_UNSIGNED_BYTE$7) {
        data = new Uint8Array(size)
      } else if (type === GL_FLOAT$7) {
        data = data || new Float32Array(size)
      }
    }

    // Type check
    check$1.isTypedArray(data, 'data buffer for regl.read() must be a typedarray')
    check$1(data.byteLength >= size, 'data buffer for regl.read() too small')

    // Run read pixels
    gl.pixelStorei(GL_PACK_ALIGNMENT, 4)
    gl.readPixels(x, y, width, height, GL_RGBA$3,
      type,
      data)

    return data
  }

  function readPixelsFBO (options) {
    var result
    framebufferState.setFBO({
      framebuffer: options.framebuffer
    }, function () {
      result = readPixelsImpl(options)
    })
    return result
  }

  function readPixels (options) {
    if (!options || !('framebuffer' in options)) {
      return readPixelsImpl(options)
    } else {
      return readPixelsFBO(options)
    }
  }

  return readPixels
}

var precompiled = {
  "12642.28": function (_gs, g0, g18, g19, g52, g56, g120, g197) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v117,v194;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v117={
  }
  ;
  v194={
  }
  ;
  return {
  "draw":function(a0){
  var v53,v54,v55,v57,v58,v59,v106,v107,v108,v109,v110,v111,v112,v113,v114,v115,v116,v118,v119;
  v53=v14.angle_instanced_arrays;
  v54=a0["framebuffer"];
  v55=v13.getFramebuffer(v54);
  if(!(!v54||v55))g18.commandRaise(g56,g19);
  v57=v13.next;
  v13.next=v55;
  v58=v2.framebufferWidth;
  v2.framebufferWidth=v55?v55.width:v2.drawingBufferWidth;
  v59=v2.framebufferHeight;
  v2.framebufferHeight=v55?v55.height:v2.drawingBufferHeight;
  if(v55!==v13.cur){
  if(v55){
  v1.bindFramebuffer(36160,v55.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v55;
  }
  if(v5.dirty){
  var v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95,v96,v97,v98,v99,v100,v101,v102,v103,v104,v105;
  v60=v4.dither;
  if(v60!==v5.dither){
  if(v60){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v60;
  }
  v61=v4.blend_enable;
  if(v61!==v5.blend_enable){
  if(v61){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v61;
  }
  v62=v20[0];
  v63=v20[1];
  v64=v20[2];
  v65=v20[3];
  if(v62!==v21[0]||v63!==v21[1]||v64!==v21[2]||v65!==v21[3]){
  v1.blendColor(v62,v63,v64,v65);
  v21[0]=v62;
  v21[1]=v63;
  v21[2]=v64;
  v21[3]=v65;
  }
  v66=v22[0];
  v67=v22[1];
  if(v66!==v23[0]||v67!==v23[1]){
  v1.blendEquationSeparate(v66,v67);
  v23[0]=v66;
  v23[1]=v67;
  }
  v68=v24[0];
  v69=v24[1];
  v70=v24[2];
  v71=v24[3];
  if(v68!==v25[0]||v69!==v25[1]||v70!==v25[2]||v71!==v25[3]){
  v1.blendFuncSeparate(v68,v69,v70,v71);
  v25[0]=v68;
  v25[1]=v69;
  v25[2]=v70;
  v25[3]=v71;
  }
  v72=v4.depth_enable;
  if(v72!==v5.depth_enable){
  if(v72){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v72;
  }
  v73=v4.depth_func;
  if(v73!==v5.depth_func){
  v1.depthFunc(v73);
  v5.depth_func=v73;
  }
  v74=v26[0];
  v75=v26[1];
  if(v74!==v27[0]||v75!==v27[1]){
  v1.depthRange(v74,v75);
  v27[0]=v74;
  v27[1]=v75;
  }
  v76=v4.depth_mask;
  if(v76!==v5.depth_mask){
  v1.depthMask(v76);
  v5.depth_mask=v76;
  }
  v77=v28[0];
  v78=v28[1];
  v79=v28[2];
  v80=v28[3];
  if(v77!==v29[0]||v78!==v29[1]||v79!==v29[2]||v80!==v29[3]){
  v1.colorMask(v77,v78,v79,v80);
  v29[0]=v77;
  v29[1]=v78;
  v29[2]=v79;
  v29[3]=v80;
  }
  v81=v4.cull_enable;
  if(v81!==v5.cull_enable){
  if(v81){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v81;
  }
  v82=v4.cull_face;
  if(v82!==v5.cull_face){
  v1.cullFace(v82);
  v5.cull_face=v82;
  }
  v83=v4.frontFace;
  if(v83!==v5.frontFace){
  v1.frontFace(v83);
  v5.frontFace=v83;
  }
  v84=v4.lineWidth;
  if(v84!==v5.lineWidth){
  v1.lineWidth(v84);
  v5.lineWidth=v84;
  }
  v85=v4.polygonOffset_enable;
  if(v85!==v5.polygonOffset_enable){
  if(v85){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v85;
  }
  v86=v30[0];
  v87=v30[1];
  if(v86!==v31[0]||v87!==v31[1]){
  v1.polygonOffset(v86,v87);
  v31[0]=v86;
  v31[1]=v87;
  }
  v88=v4.sample_alpha;
  if(v88!==v5.sample_alpha){
  if(v88){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v88;
  }
  v89=v4.sample_enable;
  if(v89!==v5.sample_enable){
  if(v89){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v89;
  }
  v90=v32[0];
  v91=v32[1];
  if(v90!==v33[0]||v91!==v33[1]){
  v1.sampleCoverage(v90,v91);
  v33[0]=v90;
  v33[1]=v91;
  }
  v92=v4.stencil_enable;
  if(v92!==v5.stencil_enable){
  if(v92){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v92;
  }
  v93=v4.stencil_mask;
  if(v93!==v5.stencil_mask){
  v1.stencilMask(v93);
  v5.stencil_mask=v93;
  }
  v94=v34[0];
  v95=v34[1];
  v96=v34[2];
  if(v94!==v35[0]||v95!==v35[1]||v96!==v35[2]){
  v1.stencilFunc(v94,v95,v96);
  v35[0]=v94;
  v35[1]=v95;
  v35[2]=v96;
  }
  v97=v36[0];
  v98=v36[1];
  v99=v36[2];
  v100=v36[3];
  if(v97!==v37[0]||v98!==v37[1]||v99!==v37[2]||v100!==v37[3]){
  v1.stencilOpSeparate(v97,v98,v99,v100);
  v37[0]=v97;
  v37[1]=v98;
  v37[2]=v99;
  v37[3]=v100;
  }
  v101=v38[0];
  v102=v38[1];
  v103=v38[2];
  v104=v38[3];
  if(v101!==v39[0]||v102!==v39[1]||v103!==v39[2]||v104!==v39[3]){
  v1.stencilOpSeparate(v101,v102,v103,v104);
  v39[0]=v101;
  v39[1]=v102;
  v39[2]=v103;
  v39[3]=v104;
  }
  v105=v4.scissor_enable;
  if(v105!==v5.scissor_enable){
  if(v105){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v105;
  }
  }
  v106=v2.framebufferWidth;
  v107=v2.framebufferHeight;
  v108=v2.viewportWidth;
  v2.viewportWidth=v106;
  v109=v2.viewportHeight;
  v2.viewportHeight=v107;
  v1.viewport(0,0,v106,v107);
  v43[0]=0;
  v43[1]=0;
  v43[2]=v106;
  v43[3]=v107;
  v110=v2.framebufferWidth;
  v111=v2.framebufferHeight;
  v1.scissor(0,0,v110,v111);
  v41[0]=0;
  v41[1]=0;
  v41[2]=v110;
  v41[3]=v111;
  v112=v5.profile;
  if(v112){
  v113=performance.now();
  g52.count++;
  }
  v114=v9.frag;
  v115=v9.vert;
  v116=v9.program(v115,v114,g19);
  v1.useProgram(v116.program);
  v11.setVAO(null);
  v118=v116.id;
  v119=v117[v118];
  if(v119){
  v119.call(this,a0);
  }
  else{
  v119=v117[v118]=g120(v116);
  v119.call(this,a0);
  }
  v5.dirty=true;
  v11.setVAO(null);
  v13.next=v57;
  v2.framebufferWidth=v58;
  v2.framebufferHeight=v59;
  v2.viewportWidth=v108;
  v2.viewportHeight=v109;
  if(v112){
  g52.cpuTime+=performance.now()-v113;
  }
  }
  ,"scope":function(a0,a1,a2){
  var v121,v122,v123,v124,v125,v126,v127,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141;
  v121=a0["framebuffer"];
  v122=v13.getFramebuffer(v121);
  if(!(!v121||v122))g18.commandRaise(g56,g19);
  v123=v13.next;
  v13.next=v122;
  v124=v2.framebufferWidth;
  v2.framebufferWidth=v122?v122.width:v2.drawingBufferWidth;
  v125=v2.framebufferHeight;
  v2.framebufferHeight=v122?v122.height:v2.drawingBufferHeight;
  v126=v2.framebufferWidth;
  v127=v2.framebufferHeight;
  v128=v2.viewportWidth;
  v2.viewportWidth=v126;
  v129=v2.viewportHeight;
  v2.viewportHeight=v127;
  v130=v42[0];
  v42[0]=_gs[0];
  v131=v42[1];
  v42[1]=_gs[1];
  v132=v42[2];
  v42[2]=_gs[2];
  v133=v42[3];
  v42[3]=_gs[3];
  v134=v2.framebufferWidth;
  v135=v2.framebufferHeight;
  v136=v40[0];
  v40[0]=_gs[4];
  v137=v40[1];
  v40[1]=_gs[5];
  v138=v40[2];
  v40[2]=_gs[6];
  v139=v40[3];
  v40[3]=_gs[7];
  v140=v5.profile;
  if(v140){
  v141=performance.now();
  g52.count++;
  }
  v5.dirty=true;
  a1(v2,a0,a2);
  v13.next=v123;
  v2.framebufferWidth=v124;
  v2.framebufferHeight=v125;
  v2.viewportWidth=v128;
  v2.viewportHeight=v129;
  v42[0]=v130;
  v42[1]=v131;
  v42[2]=v132;
  v42[3]=v133;
  v40[0]=v136;
  v40[1]=v137;
  v40[2]=v138;
  v40[3]=v139;
  if(v140){
  g52.cpuTime+=performance.now()-v141;
  }
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v142,v189,v190,v191,v192,v193,v195,v196;
  v142=v14.angle_instanced_arrays;
  if(v5.dirty){
  var v143,v144,v145,v146,v147,v148,v149,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v165,v166,v167,v168,v169,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v183,v184,v185,v186,v187,v188;
  v143=v4.dither;
  if(v143!==v5.dither){
  if(v143){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v143;
  }
  v144=v4.blend_enable;
  if(v144!==v5.blend_enable){
  if(v144){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v144;
  }
  v145=v20[0];
  v146=v20[1];
  v147=v20[2];
  v148=v20[3];
  if(v145!==v21[0]||v146!==v21[1]||v147!==v21[2]||v148!==v21[3]){
  v1.blendColor(v145,v146,v147,v148);
  v21[0]=v145;
  v21[1]=v146;
  v21[2]=v147;
  v21[3]=v148;
  }
  v149=v22[0];
  v150=v22[1];
  if(v149!==v23[0]||v150!==v23[1]){
  v1.blendEquationSeparate(v149,v150);
  v23[0]=v149;
  v23[1]=v150;
  }
  v151=v24[0];
  v152=v24[1];
  v153=v24[2];
  v154=v24[3];
  if(v151!==v25[0]||v152!==v25[1]||v153!==v25[2]||v154!==v25[3]){
  v1.blendFuncSeparate(v151,v152,v153,v154);
  v25[0]=v151;
  v25[1]=v152;
  v25[2]=v153;
  v25[3]=v154;
  }
  v155=v4.depth_enable;
  if(v155!==v5.depth_enable){
  if(v155){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v155;
  }
  v156=v4.depth_func;
  if(v156!==v5.depth_func){
  v1.depthFunc(v156);
  v5.depth_func=v156;
  }
  v157=v26[0];
  v158=v26[1];
  if(v157!==v27[0]||v158!==v27[1]){
  v1.depthRange(v157,v158);
  v27[0]=v157;
  v27[1]=v158;
  }
  v159=v4.depth_mask;
  if(v159!==v5.depth_mask){
  v1.depthMask(v159);
  v5.depth_mask=v159;
  }
  v160=v28[0];
  v161=v28[1];
  v162=v28[2];
  v163=v28[3];
  if(v160!==v29[0]||v161!==v29[1]||v162!==v29[2]||v163!==v29[3]){
  v1.colorMask(v160,v161,v162,v163);
  v29[0]=v160;
  v29[1]=v161;
  v29[2]=v162;
  v29[3]=v163;
  }
  v164=v4.cull_enable;
  if(v164!==v5.cull_enable){
  if(v164){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v164;
  }
  v165=v4.cull_face;
  if(v165!==v5.cull_face){
  v1.cullFace(v165);
  v5.cull_face=v165;
  }
  v166=v4.frontFace;
  if(v166!==v5.frontFace){
  v1.frontFace(v166);
  v5.frontFace=v166;
  }
  v167=v4.lineWidth;
  if(v167!==v5.lineWidth){
  v1.lineWidth(v167);
  v5.lineWidth=v167;
  }
  v168=v4.polygonOffset_enable;
  if(v168!==v5.polygonOffset_enable){
  if(v168){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v168;
  }
  v169=v30[0];
  v170=v30[1];
  if(v169!==v31[0]||v170!==v31[1]){
  v1.polygonOffset(v169,v170);
  v31[0]=v169;
  v31[1]=v170;
  }
  v171=v4.sample_alpha;
  if(v171!==v5.sample_alpha){
  if(v171){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v171;
  }
  v172=v4.sample_enable;
  if(v172!==v5.sample_enable){
  if(v172){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v172;
  }
  v173=v32[0];
  v174=v32[1];
  if(v173!==v33[0]||v174!==v33[1]){
  v1.sampleCoverage(v173,v174);
  v33[0]=v173;
  v33[1]=v174;
  }
  v175=v4.stencil_enable;
  if(v175!==v5.stencil_enable){
  if(v175){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v175;
  }
  v176=v4.stencil_mask;
  if(v176!==v5.stencil_mask){
  v1.stencilMask(v176);
  v5.stencil_mask=v176;
  }
  v177=v34[0];
  v178=v34[1];
  v179=v34[2];
  if(v177!==v35[0]||v178!==v35[1]||v179!==v35[2]){
  v1.stencilFunc(v177,v178,v179);
  v35[0]=v177;
  v35[1]=v178;
  v35[2]=v179;
  }
  v180=v36[0];
  v181=v36[1];
  v182=v36[2];
  v183=v36[3];
  if(v180!==v37[0]||v181!==v37[1]||v182!==v37[2]||v183!==v37[3]){
  v1.stencilOpSeparate(v180,v181,v182,v183);
  v37[0]=v180;
  v37[1]=v181;
  v37[2]=v182;
  v37[3]=v183;
  }
  v184=v38[0];
  v185=v38[1];
  v186=v38[2];
  v187=v38[3];
  if(v184!==v39[0]||v185!==v39[1]||v186!==v39[2]||v187!==v39[3]){
  v1.stencilOpSeparate(v184,v185,v186,v187);
  v39[0]=v184;
  v39[1]=v185;
  v39[2]=v186;
  v39[3]=v187;
  }
  v188=v4.scissor_enable;
  if(v188!==v5.scissor_enable){
  if(v188){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v188;
  }
  }
  v189=v5.profile;
  if(v189){
  v190=performance.now();
  g52.count+=a1;
  }
  v191=v9.frag;
  v192=v9.vert;
  v193=v9.program(v192,v191,g19);
  v1.useProgram(v193.program);
  v11.setVAO(null);
  v195=v193.id;
  v196=v194[v195];
  if(v196){
  v196.call(this,a0,a1);
  }
  else{
  v196=v194[v195]=g197(v193);
  v196.call(this,a0,a1);
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v189){
  g52.cpuTime+=performance.now()-v190;
  }
  }
  ,}
  
  },
  "9912.18": function (_gs, g0, g18, g19, g54, g55) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v66,v67,v68,v69,v70,v71,v74,v75,v78,v79,v86,v87,v88,v89,v92,v93,v94,v95,v96,v97,v98,v99,v100,v101;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v66=v4.blend_color;
  v67=v5.blend_color;
  v68=v4.blend_equation;
  v69=v5.blend_equation;
  v70=v4.blend_func;
  v71=v5.blend_func;
  v74=v4.depth_range;
  v75=v5.depth_range;
  v78=v4.colorMask;
  v79=v5.colorMask;
  v86=v4.polygonOffset_offset;
  v87=v5.polygonOffset_offset;
  v88=v4.sample_coverage;
  v89=v5.sample_coverage;
  v92=v4.stencil_func;
  v93=v5.stencil_func;
  v94=v4.stencil_opFront;
  v95=v5.stencil_opFront;
  v96=v4.stencil_opBack;
  v97=v5.stencil_opBack;
  v98=v4.scissor_box;
  v99=v5.scissor_box;
  v100=v4.viewport;
  v101=v5.viewport;
  return {
  "poll":function(){
  var v52;
  var v57,v58,v59,v60,v61,v62,v63,v64,v65,v72,v73,v76,v77,v80,v81,v82,v83,v84,v85,v90,v91;
  v5.dirty=false;
  v57=v4.dither;
  v58=v4.blend_enable;
  v59=v4.depth_enable;
  v60=v4.cull_enable;
  v61=v4.polygonOffset_enable;
  v62=v4.sample_alpha;
  v63=v4.sample_enable;
  v64=v4.stencil_enable;
  v65=v4.scissor_enable;
  v72=v4.depth_func;
  v73=v5.depth_func;
  v76=v4.depth_mask;
  v77=v5.depth_mask;
  v80=v4.cull_face;
  v81=v5.cull_face;
  v82=v4.frontFace;
  v83=v5.frontFace;
  v84=v4.lineWidth;
  v85=v5.lineWidth;
  v90=v4.stencil_mask;
  v91=v5.stencil_mask;
  v52=v13.next;
  if(v52!==v13.cur){
  if(v52){
  v1.bindFramebuffer(36160,v52.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v52;
  }
  if(v57!==v5.dither){
  if(v57){
  v1.enable(3024)}
  else{
  v1.disable(3024)}
  v5.dither=v57;
  }
  if(v58!==v5.blend_enable){
  if(v58){
  v1.enable(3042)}
  else{
  v1.disable(3042)}
  v5.blend_enable=v58;
  }
  if(v59!==v5.depth_enable){
  if(v59){
  v1.enable(2929)}
  else{
  v1.disable(2929)}
  v5.depth_enable=v59;
  }
  if(v60!==v5.cull_enable){
  if(v60){
  v1.enable(2884)}
  else{
  v1.disable(2884)}
  v5.cull_enable=v60;
  }
  if(v61!==v5.polygonOffset_enable){
  if(v61){
  v1.enable(32823)}
  else{
  v1.disable(32823)}
  v5.polygonOffset_enable=v61;
  }
  if(v62!==v5.sample_alpha){
  if(v62){
  v1.enable(32926)}
  else{
  v1.disable(32926)}
  v5.sample_alpha=v62;
  }
  if(v63!==v5.sample_enable){
  if(v63){
  v1.enable(32928)}
  else{
  v1.disable(32928)}
  v5.sample_enable=v63;
  }
  if(v64!==v5.stencil_enable){
  if(v64){
  v1.enable(2960)}
  else{
  v1.disable(2960)}
  v5.stencil_enable=v64;
  }
  if(v65!==v5.scissor_enable){
  if(v65){
  v1.enable(3089)}
  else{
  v1.disable(3089)}
  v5.scissor_enable=v65;
  }
  if(v66[0]!==v67[0]||v66[1]!==v67[1]||v66[2]!==v67[2]||v66[3]!==v67[3]){
  v1.blendColor(v66[0],v66[1],v66[2],v66[3]);
  v67[0]=v66[0];
  v67[1]=v66[1];
  v67[2]=v66[2];
  v67[3]=v66[3];
  }
  if(v68[0]!==v69[0]||v68[1]!==v69[1]){
  v1.blendEquationSeparate(v68[0],v68[1]);
  v69[0]=v68[0];
  v69[1]=v68[1];
  }
  if(v70[0]!==v71[0]||v70[1]!==v71[1]||v70[2]!==v71[2]||v70[3]!==v71[3]){
  v1.blendFuncSeparate(v70[0],v70[1],v70[2],v70[3]);
  v71[0]=v70[0];
  v71[1]=v70[1];
  v71[2]=v70[2];
  v71[3]=v70[3];
  }
  if(v72!==v73){
  v1.depthFunc(v72);
  v5.depth_func=v72;
  }
  if(v74[0]!==v75[0]||v74[1]!==v75[1]){
  v1.depthRange(v74[0],v74[1]);
  v75[0]=v74[0];
  v75[1]=v74[1];
  }
  if(v76!==v77){
  v1.depthMask(v76);
  v5.depth_mask=v76;
  }
  if(v78[0]!==v79[0]||v78[1]!==v79[1]||v78[2]!==v79[2]||v78[3]!==v79[3]){
  v1.colorMask(v78[0],v78[1],v78[2],v78[3]);
  v79[0]=v78[0];
  v79[1]=v78[1];
  v79[2]=v78[2];
  v79[3]=v78[3];
  }
  if(v80!==v81){
  v1.cullFace(v80);
  v5.cull_face=v80;
  }
  if(v82!==v83){
  v1.frontFace(v82);
  v5.frontFace=v82;
  }
  if(v84!==v85){
  v1.lineWidth(v84);
  v5.lineWidth=v84;
  }
  if(v86[0]!==v87[0]||v86[1]!==v87[1]){
  v1.polygonOffset(v86[0],v86[1]);
  v87[0]=v86[0];
  v87[1]=v86[1];
  }
  if(v88[0]!==v89[0]||v88[1]!==v89[1]){
  v1.sampleCoverage(v88[0],v88[1]);
  v89[0]=v88[0];
  v89[1]=v88[1];
  }
  if(v90!==v91){
  v1.stencilMask(v90);
  v5.stencil_mask=v90;
  }
  if(v92[0]!==v93[0]||v92[1]!==v93[1]||v92[2]!==v93[2]){
  v1.stencilFunc(v92[0],v92[1],v92[2]);
  v93[0]=v92[0];
  v93[1]=v92[1];
  v93[2]=v92[2];
  }
  if(v94[0]!==v95[0]||v94[1]!==v95[1]||v94[2]!==v95[2]||v94[3]!==v95[3]){
  v1.stencilOpSeparate(v94[0],v94[1],v94[2],v94[3]);
  v95[0]=v94[0];
  v95[1]=v94[1];
  v95[2]=v94[2];
  v95[3]=v94[3];
  }
  if(v96[0]!==v97[0]||v96[1]!==v97[1]||v96[2]!==v97[2]||v96[3]!==v97[3]){
  v1.stencilOpSeparate(v96[0],v96[1],v96[2],v96[3]);
  v97[0]=v96[0];
  v97[1]=v96[1];
  v97[2]=v96[2];
  v97[3]=v96[3];
  }
  if(v98[0]!==v99[0]||v98[1]!==v99[1]||v98[2]!==v99[2]||v98[3]!==v99[3]){
  v1.scissor(v98[0],v98[1],v98[2],v98[3]);
  v99[0]=v98[0];
  v99[1]=v98[1];
  v99[2]=v98[2];
  v99[3]=v98[3];
  }
  if(v100[0]!==v101[0]||v100[1]!==v101[1]||v100[2]!==v101[2]||v100[3]!==v101[3]){
  v1.viewport(v100[0],v100[1],v100[2],v100[3]);
  v101[0]=v100[0];
  v101[1]=v100[1];
  v101[2]=v100[2];
  v101[3]=v100[3];
  }
  }
  ,"refresh":function(){
  var v53,v56;
  var v57,v58,v59,v60,v61,v62,v63,v64,v65,v72,v73,v76,v77,v80,v81,v82,v83,v84,v85,v90,v91;
  v5.dirty=false;
  v57=v4.dither;
  v58=v4.blend_enable;
  v59=v4.depth_enable;
  v60=v4.cull_enable;
  v61=v4.polygonOffset_enable;
  v62=v4.sample_alpha;
  v63=v4.sample_enable;
  v64=v4.stencil_enable;
  v65=v4.scissor_enable;
  v72=v4.depth_func;
  v73=v5.depth_func;
  v76=v4.depth_mask;
  v77=v5.depth_mask;
  v80=v4.cull_face;
  v81=v5.cull_face;
  v82=v4.frontFace;
  v83=v5.frontFace;
  v84=v4.lineWidth;
  v85=v5.lineWidth;
  v90=v4.stencil_mask;
  v91=v5.stencil_mask;
  v53=v13.next;
  if(v53){
  v1.bindFramebuffer(36160,v53.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v53;
  v56=v10;
  for(var i=0;
  i<g55;
  ++i){
  if(v56[i].buffer){
  v1.enableVertexAttribArray(i);
  v1.bindBuffer(34962,v56[i].buffer.buffer);
  v1.vertexAttribPointer(i,v56[i].size,v56[i].type,v56[i].normalized,v56[i].stride,v56[i].offset);
  }
  else{
  v1.disableVertexAttribArray(i);
  v1.vertexAttrib4f(i,v56[i].x,v56[i].y,v56[i].z,v56[i].w);
  v56[i].buffer=null;
  }
  }
  for(var i=0;
  i<g55;
  ++i){
  g54.vertexAttribDivisorANGLE(i,v56[i].divisor);
  }
  v11.currentVAO=null;
  v11.setVAO(v11.targetVAO);
  if(v57){
  v1.enable(3024)}
  else{
  v1.disable(3024)}
  v5.dither=v57;
  if(v58){
  v1.enable(3042)}
  else{
  v1.disable(3042)}
  v5.blend_enable=v58;
  if(v59){
  v1.enable(2929)}
  else{
  v1.disable(2929)}
  v5.depth_enable=v59;
  if(v60){
  v1.enable(2884)}
  else{
  v1.disable(2884)}
  v5.cull_enable=v60;
  if(v61){
  v1.enable(32823)}
  else{
  v1.disable(32823)}
  v5.polygonOffset_enable=v61;
  if(v62){
  v1.enable(32926)}
  else{
  v1.disable(32926)}
  v5.sample_alpha=v62;
  if(v63){
  v1.enable(32928)}
  else{
  v1.disable(32928)}
  v5.sample_enable=v63;
  if(v64){
  v1.enable(2960)}
  else{
  v1.disable(2960)}
  v5.stencil_enable=v64;
  if(v65){
  v1.enable(3089)}
  else{
  v1.disable(3089)}
  v5.scissor_enable=v65;
  v1.blendColor(v66[0],v66[1],v66[2],v66[3]);
  v67[0]=v66[0];
  v67[1]=v66[1];
  v67[2]=v66[2];
  v67[3]=v66[3];
  v1.blendEquationSeparate(v68[0],v68[1]);
  v69[0]=v68[0];
  v69[1]=v68[1];
  v1.blendFuncSeparate(v70[0],v70[1],v70[2],v70[3]);
  v71[0]=v70[0];
  v71[1]=v70[1];
  v71[2]=v70[2];
  v71[3]=v70[3];
  v1.depthFunc(v72);
  v5.depth_func=v72;
  v1.depthRange(v74[0],v74[1]);
  v75[0]=v74[0];
  v75[1]=v74[1];
  v1.depthMask(v76);
  v5.depth_mask=v76;
  v1.colorMask(v78[0],v78[1],v78[2],v78[3]);
  v79[0]=v78[0];
  v79[1]=v78[1];
  v79[2]=v78[2];
  v79[3]=v78[3];
  v1.cullFace(v80);
  v5.cull_face=v80;
  v1.frontFace(v82);
  v5.frontFace=v82;
  v1.lineWidth(v84);
  v5.lineWidth=v84;
  v1.polygonOffset(v86[0],v86[1]);
  v87[0]=v86[0];
  v87[1]=v86[1];
  v1.sampleCoverage(v88[0],v88[1]);
  v89[0]=v88[0];
  v89[1]=v88[1];
  v1.stencilMask(v90);
  v5.stencil_mask=v90;
  v1.stencilFunc(v92[0],v92[1],v92[2]);
  v93[0]=v92[0];
  v93[1]=v92[1];
  v93[2]=v92[2];
  v1.stencilOpSeparate(v94[0],v94[1],v94[2],v94[3]);
  v95[0]=v94[0];
  v95[1]=v94[1];
  v95[2]=v94[2];
  v95[3]=v94[3];
  v1.stencilOpSeparate(v96[0],v96[1],v96[2],v96[3]);
  v97[0]=v96[0];
  v97[1]=v96[1];
  v97[2]=v96[2];
  v97[3]=v96[3];
  v1.scissor(v98[0],v98[1],v98[2],v98[3]);
  v99[0]=v98[0];
  v99[1]=v98[1];
  v99[2]=v98[2];
  v99[3]=v98[3];
  v1.viewport(v100[0],v100[1],v100[2],v100[3]);
  v101[0]=v100[0];
  v101[1]=v100[1];
  v101[2]=v100[2];
  v101[3]=v100[3];
  }
  ,}
  
  },
  "52671.248": function (_gs, g0, g18, g19, g52, g93, g100, g102, g104, g111, g114, g128, g133, g147, g152, g166, g171, g185, g190, g204, g208, g209, g212, g215, g217, g218, g220, g222, g224, g225, g227, g228, g230, g233, g235, g238, g240, g241, g243, g246, g248, g251, g252, g254, g303, g332, g345, g372, g399, g426, g453, g480) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v54,v55,v56,v57;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v53.stride=8;
  v53.offset=8;
  v53.divisor=1;
  v54={
  }
  ;
  v54.stride=8;
  v54.offset=16;
  v54.divisor=1;
  v55={
  }
  ;
  v55.stride=8;
  v55.offset=8;
  v55.divisor=1;
  v56={
  }
  ;
  v56.stride=8;
  v56.offset=16;
  v56.divisor=1;
  v57={
  }
  ;
  v57.stride=4;
  v57.offset=0;
  v57.divisor=1;
  return {
  "draw":function(a0){
  var v58,v59,v92,v94,v95,v96,v97,v98,v99,v101,v103,v105,v106,v107,v108,v109,v110,v112,v113,v115,v116,v117,v118,v119,v120,v121,v122,v123,v124,v125,v126,v127,v129,v130,v131,v132,v134,v135,v136,v137,v138,v139,v140,v141,v142,v143,v144,v145,v146,v148,v149,v150,v151,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v165,v167,v168,v169,v170,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v183,v184,v186,v187,v188,v189,v191,v192,v193,v194,v195,v196,v197,v198,v199,v200,v201,v202,v203,v205,v206,v207,v210,v211,v213,v214,v216,v219,v221,v223,v226,v229,v231,v232,v234,v236,v237,v239,v242,v244,v245,v247,v249,v250,v253,v255,v256,v257,v258,v259,v260;
  v58=v14.angle_instanced_arrays;
  v59=v13.next;
  if(v59!==v13.cur){
  if(v59){
  v1.bindFramebuffer(36160,v59.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v59;
  }
  if(v5.dirty){
  var v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91;
  v60=v4.dither;
  if(v60!==v5.dither){
  if(v60){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v60;
  }
  v61=v4.depth_func;
  if(v61!==v5.depth_func){
  v1.depthFunc(v61);
  v5.depth_func=v61;
  }
  v62=v26[0];
  v63=v26[1];
  if(v62!==v27[0]||v63!==v27[1]){
  v1.depthRange(v62,v63);
  v27[0]=v62;
  v27[1]=v63;
  }
  v64=v4.depth_mask;
  if(v64!==v5.depth_mask){
  v1.depthMask(v64);
  v5.depth_mask=v64;
  }
  v65=v28[0];
  v66=v28[1];
  v67=v28[2];
  v68=v28[3];
  if(v65!==v29[0]||v66!==v29[1]||v67!==v29[2]||v68!==v29[3]){
  v1.colorMask(v65,v66,v67,v68);
  v29[0]=v65;
  v29[1]=v66;
  v29[2]=v67;
  v29[3]=v68;
  }
  v69=v4.cull_enable;
  if(v69!==v5.cull_enable){
  if(v69){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v69;
  }
  v70=v4.cull_face;
  if(v70!==v5.cull_face){
  v1.cullFace(v70);
  v5.cull_face=v70;
  }
  v71=v4.frontFace;
  if(v71!==v5.frontFace){
  v1.frontFace(v71);
  v5.frontFace=v71;
  }
  v72=v4.lineWidth;
  if(v72!==v5.lineWidth){
  v1.lineWidth(v72);
  v5.lineWidth=v72;
  }
  v73=v4.polygonOffset_enable;
  if(v73!==v5.polygonOffset_enable){
  if(v73){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v73;
  }
  v74=v30[0];
  v75=v30[1];
  if(v74!==v31[0]||v75!==v31[1]){
  v1.polygonOffset(v74,v75);
  v31[0]=v74;
  v31[1]=v75;
  }
  v76=v4.sample_alpha;
  if(v76!==v5.sample_alpha){
  if(v76){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v76;
  }
  v77=v4.sample_enable;
  if(v77!==v5.sample_enable){
  if(v77){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v77;
  }
  v78=v32[0];
  v79=v32[1];
  if(v78!==v33[0]||v79!==v33[1]){
  v1.sampleCoverage(v78,v79);
  v33[0]=v78;
  v33[1]=v79;
  }
  v80=v4.stencil_mask;
  if(v80!==v5.stencil_mask){
  v1.stencilMask(v80);
  v5.stencil_mask=v80;
  }
  v81=v34[0];
  v82=v34[1];
  v83=v34[2];
  if(v81!==v35[0]||v82!==v35[1]||v83!==v35[2]){
  v1.stencilFunc(v81,v82,v83);
  v35[0]=v81;
  v35[1]=v82;
  v35[2]=v83;
  }
  v84=v36[0];
  v85=v36[1];
  v86=v36[2];
  v87=v36[3];
  if(v84!==v37[0]||v85!==v37[1]||v86!==v37[2]||v87!==v37[3]){
  v1.stencilOpSeparate(v84,v85,v86,v87);
  v37[0]=v84;
  v37[1]=v85;
  v37[2]=v86;
  v37[3]=v87;
  }
  v88=v38[0];
  v89=v38[1];
  v90=v38[2];
  v91=v38[3];
  if(v88!==v39[0]||v89!==v39[1]||v90!==v39[2]||v91!==v39[3]){
  v1.stencilOpSeparate(v88,v89,v90,v91);
  v39[0]=v88;
  v39[1]=v89;
  v39[2]=v90;
  v39[3]=v91;
  }
  }
  v92=a0["viewport"];
  if(!(v92&&typeof v92==="object"))g18.commandRaise(g93,g19);
  v94=v92.x|0;
  v95=v92.y|0;
  v96="width" in v92?v92.width|0:(v2.framebufferWidth-v94);
  v97="height" in v92?v92.height|0:(v2.framebufferHeight-v95);
  if(!(v96>=0&&v97>=0))g18.commandRaise(g93,g19);
  v98=v2.viewportWidth;
  v2.viewportWidth=v96;
  v99=v2.viewportHeight;
  v2.viewportHeight=v97;
  v1.viewport(v94,v95,v96,v97);
  v43[0]=v94;
  v43[1]=v95;
  v43[2]=v96;
  v43[3]=v97;
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  v101=g100.call(this,v2,a0,0);
  if(!(typeof v101==="boolean"))g18.commandRaise(g102,g19);
  if(v101){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v101;
  v103=a0["viewport"];
  if(!(v103&&typeof v103==="object"))g18.commandRaise(g104,g19);
  v105=v103.x|0;
  v106=v103.y|0;
  v107="width" in v103?v103.width|0:(v2.framebufferWidth-v105);
  v108="height" in v103?v103.height|0:(v2.framebufferHeight-v106);
  if(!(v107>=0&&v108>=0))g18.commandRaise(g104,g19);
  v1.scissor(v105,v106,v107,v108);
  v41[0]=v105;
  v41[1]=v106;
  v41[2]=v107;
  v41[3]=v108;
  if(_gs[2]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[3];
  if(_gs[4]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[5];
  v109=v5.profile;
  if(v109){
  v110=performance.now();
  g52.count++;
  }
  v1.useProgram(g111.program);
  v112=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v113=a0["positionBuffer"];
  v53.buffer=v113;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g114,g19);
  v115=false;
  v116=1;
  v117=0;
  v118=0;
  v119=0;
  v120=0;
  v121=null;
  v122=0;
  v123=false;
  v124=5126;
  v125=0;
  v126=0;
  v127=0;
  if(v16(v53)){
  v115=true;
  v121=v8.createStream(34962,v53);
  v124=v121.dtype;
  }
  else{
  v121=v8.getBuffer(v53);
  if(v121){
  v124=v121.dtype;
  }
  else if("constant" in v53){
  v116=2;
  if(typeof v53.constant === "number"){
  v117=v53.constant;
  v118=v119=v120=0;
  }
  else{
  v117=v53.constant.length>0?v53.constant[0]:0;
  v118=v53.constant.length>1?v53.constant[1]:0;
  v119=v53.constant.length>2?v53.constant[2]:0;
  v120=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v121=v8.createStream(34962,v53.buffer);
  }
  else{
  v121=v8.getBuffer(v53.buffer);
  }
  v124="type" in v53?v49[v53.type]:v121.dtype;
  v123=!!v53.normalized;
  v122=v53.size|0;
  v125=v53.offset|0;
  v126=v53.stride|0;
  v127=v53.divisor|0;
  }
  }
  v129=g128.location;
  v130=v10[v129];
  if(v116===1){
  if(!v130.buffer){
  v1.enableVertexAttribArray(v129);
  }
  v131=v122||2;
  if(v130.type!==v124||v130.size!==v131||v130.buffer!==v121||v130.normalized!==v123||v130.offset!==v125||v130.stride!==v126){
  v1.bindBuffer(34962,v121.buffer);
  v1.vertexAttribPointer(v129,v131,v124,v123,v126,v125);
  v130.type=v124;
  v130.size=v131;
  v130.buffer=v121;
  v130.normalized=v123;
  v130.offset=v125;
  v130.stride=v126;
  }
  if(v130.divisor!==v127){
  v112.vertexAttribDivisorANGLE(v129,v127);
  v130.divisor=v127;
  }
  }
  else{
  if(v130.buffer){
  v1.disableVertexAttribArray(v129);
  v130.buffer=null;
  }
  if(v130.x!==v117||v130.y!==v118||v130.z!==v119||v130.w!==v120){
  v1.vertexAttrib4f(v129,v117,v118,v119,v120);
  v130.x=v117;
  v130.y=v118;
  v130.z=v119;
  v130.w=v120;
  }
  }
  v132=a0["positionFractBuffer"];
  v55.buffer=v132;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g133,g19);
  v134=false;
  v135=1;
  v136=0;
  v137=0;
  v138=0;
  v139=0;
  v140=null;
  v141=0;
  v142=false;
  v143=5126;
  v144=0;
  v145=0;
  v146=0;
  if(v16(v55)){
  v134=true;
  v140=v8.createStream(34962,v55);
  v143=v140.dtype;
  }
  else{
  v140=v8.getBuffer(v55);
  if(v140){
  v143=v140.dtype;
  }
  else if("constant" in v55){
  v135=2;
  if(typeof v55.constant === "number"){
  v136=v55.constant;
  v137=v138=v139=0;
  }
  else{
  v136=v55.constant.length>0?v55.constant[0]:0;
  v137=v55.constant.length>1?v55.constant[1]:0;
  v138=v55.constant.length>2?v55.constant[2]:0;
  v139=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v140=v8.createStream(34962,v55.buffer);
  }
  else{
  v140=v8.getBuffer(v55.buffer);
  }
  v143="type" in v55?v49[v55.type]:v140.dtype;
  v142=!!v55.normalized;
  v141=v55.size|0;
  v144=v55.offset|0;
  v145=v55.stride|0;
  v146=v55.divisor|0;
  }
  }
  v148=g147.location;
  v149=v10[v148];
  if(v135===1){
  if(!v149.buffer){
  v1.enableVertexAttribArray(v148);
  }
  v150=v141||2;
  if(v149.type!==v143||v149.size!==v150||v149.buffer!==v140||v149.normalized!==v142||v149.offset!==v144||v149.stride!==v145){
  v1.bindBuffer(34962,v140.buffer);
  v1.vertexAttribPointer(v148,v150,v143,v142,v145,v144);
  v149.type=v143;
  v149.size=v150;
  v149.buffer=v140;
  v149.normalized=v142;
  v149.offset=v144;
  v149.stride=v145;
  }
  if(v149.divisor!==v146){
  v112.vertexAttribDivisorANGLE(v148,v146);
  v149.divisor=v146;
  }
  }
  else{
  if(v149.buffer){
  v1.disableVertexAttribArray(v148);
  v149.buffer=null;
  }
  if(v149.x!==v136||v149.y!==v137||v149.z!==v138||v149.w!==v139){
  v1.vertexAttrib4f(v148,v136,v137,v138,v139);
  v149.x=v136;
  v149.y=v137;
  v149.z=v138;
  v149.w=v139;
  }
  }
  v151=a0["positionBuffer"];
  v54.buffer=v151;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g152,g19);
  v153=false;
  v154=1;
  v155=0;
  v156=0;
  v157=0;
  v158=0;
  v159=null;
  v160=0;
  v161=false;
  v162=5126;
  v163=0;
  v164=0;
  v165=0;
  if(v16(v54)){
  v153=true;
  v159=v8.createStream(34962,v54);
  v162=v159.dtype;
  }
  else{
  v159=v8.getBuffer(v54);
  if(v159){
  v162=v159.dtype;
  }
  else if("constant" in v54){
  v154=2;
  if(typeof v54.constant === "number"){
  v155=v54.constant;
  v156=v157=v158=0;
  }
  else{
  v155=v54.constant.length>0?v54.constant[0]:0;
  v156=v54.constant.length>1?v54.constant[1]:0;
  v157=v54.constant.length>2?v54.constant[2]:0;
  v158=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v159=v8.createStream(34962,v54.buffer);
  }
  else{
  v159=v8.getBuffer(v54.buffer);
  }
  v162="type" in v54?v49[v54.type]:v159.dtype;
  v161=!!v54.normalized;
  v160=v54.size|0;
  v163=v54.offset|0;
  v164=v54.stride|0;
  v165=v54.divisor|0;
  }
  }
  v167=g166.location;
  v168=v10[v167];
  if(v154===1){
  if(!v168.buffer){
  v1.enableVertexAttribArray(v167);
  }
  v169=v160||2;
  if(v168.type!==v162||v168.size!==v169||v168.buffer!==v159||v168.normalized!==v161||v168.offset!==v163||v168.stride!==v164){
  v1.bindBuffer(34962,v159.buffer);
  v1.vertexAttribPointer(v167,v169,v162,v161,v164,v163);
  v168.type=v162;
  v168.size=v169;
  v168.buffer=v159;
  v168.normalized=v161;
  v168.offset=v163;
  v168.stride=v164;
  }
  if(v168.divisor!==v165){
  v112.vertexAttribDivisorANGLE(v167,v165);
  v168.divisor=v165;
  }
  }
  else{
  if(v168.buffer){
  v1.disableVertexAttribArray(v167);
  v168.buffer=null;
  }
  if(v168.x!==v155||v168.y!==v156||v168.z!==v157||v168.w!==v158){
  v1.vertexAttrib4f(v167,v155,v156,v157,v158);
  v168.x=v155;
  v168.y=v156;
  v168.z=v157;
  v168.w=v158;
  }
  }
  v170=a0["positionFractBuffer"];
  v56.buffer=v170;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g171,g19);
  v172=false;
  v173=1;
  v174=0;
  v175=0;
  v176=0;
  v177=0;
  v178=null;
  v179=0;
  v180=false;
  v181=5126;
  v182=0;
  v183=0;
  v184=0;
  if(v16(v56)){
  v172=true;
  v178=v8.createStream(34962,v56);
  v181=v178.dtype;
  }
  else{
  v178=v8.getBuffer(v56);
  if(v178){
  v181=v178.dtype;
  }
  else if("constant" in v56){
  v173=2;
  if(typeof v56.constant === "number"){
  v174=v56.constant;
  v175=v176=v177=0;
  }
  else{
  v174=v56.constant.length>0?v56.constant[0]:0;
  v175=v56.constant.length>1?v56.constant[1]:0;
  v176=v56.constant.length>2?v56.constant[2]:0;
  v177=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v178=v8.createStream(34962,v56.buffer);
  }
  else{
  v178=v8.getBuffer(v56.buffer);
  }
  v181="type" in v56?v49[v56.type]:v178.dtype;
  v180=!!v56.normalized;
  v179=v56.size|0;
  v182=v56.offset|0;
  v183=v56.stride|0;
  v184=v56.divisor|0;
  }
  }
  v186=g185.location;
  v187=v10[v186];
  if(v173===1){
  if(!v187.buffer){
  v1.enableVertexAttribArray(v186);
  }
  v188=v179||2;
  if(v187.type!==v181||v187.size!==v188||v187.buffer!==v178||v187.normalized!==v180||v187.offset!==v182||v187.stride!==v183){
  v1.bindBuffer(34962,v178.buffer);
  v1.vertexAttribPointer(v186,v188,v181,v180,v183,v182);
  v187.type=v181;
  v187.size=v188;
  v187.buffer=v178;
  v187.normalized=v180;
  v187.offset=v182;
  v187.stride=v183;
  }
  if(v187.divisor!==v184){
  v112.vertexAttribDivisorANGLE(v186,v184);
  v187.divisor=v184;
  }
  }
  else{
  if(v187.buffer){
  v1.disableVertexAttribArray(v186);
  v187.buffer=null;
  }
  if(v187.x!==v174||v187.y!==v175||v187.z!==v176||v187.w!==v177){
  v1.vertexAttrib4f(v186,v174,v175,v176,v177);
  v187.x=v174;
  v187.y=v175;
  v187.z=v176;
  v187.w=v177;
  }
  }
  v189=a0["colorBuffer"];
  v57.buffer=v189;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g190,g19);
  v191=false;
  v192=1;
  v193=0;
  v194=0;
  v195=0;
  v196=0;
  v197=null;
  v198=0;
  v199=false;
  v200=5126;
  v201=0;
  v202=0;
  v203=0;
  if(v16(v57)){
  v191=true;
  v197=v8.createStream(34962,v57);
  v200=v197.dtype;
  }
  else{
  v197=v8.getBuffer(v57);
  if(v197){
  v200=v197.dtype;
  }
  else if("constant" in v57){
  v192=2;
  if(typeof v57.constant === "number"){
  v193=v57.constant;
  v194=v195=v196=0;
  }
  else{
  v193=v57.constant.length>0?v57.constant[0]:0;
  v194=v57.constant.length>1?v57.constant[1]:0;
  v195=v57.constant.length>2?v57.constant[2]:0;
  v196=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v197=v8.createStream(34962,v57.buffer);
  }
  else{
  v197=v8.getBuffer(v57.buffer);
  }
  v200="type" in v57?v49[v57.type]:v197.dtype;
  v199=!!v57.normalized;
  v198=v57.size|0;
  v201=v57.offset|0;
  v202=v57.stride|0;
  v203=v57.divisor|0;
  }
  }
  v205=g204.location;
  v206=v10[v205];
  if(v192===1){
  if(!v206.buffer){
  v1.enableVertexAttribArray(v205);
  }
  v207=v198||4;
  if(v206.type!==v200||v206.size!==v207||v206.buffer!==v197||v206.normalized!==v199||v206.offset!==v201||v206.stride!==v202){
  v1.bindBuffer(34962,v197.buffer);
  v1.vertexAttribPointer(v205,v207,v200,v199,v202,v201);
  v206.type=v200;
  v206.size=v207;
  v206.buffer=v197;
  v206.normalized=v199;
  v206.offset=v201;
  v206.stride=v202;
  }
  if(v206.divisor!==v203){
  v112.vertexAttribDivisorANGLE(v205,v203);
  v206.divisor=v203;
  }
  }
  else{
  if(v206.buffer){
  v1.disableVertexAttribArray(v205);
  v206.buffer=null;
  }
  if(v206.x!==v193||v206.y!==v194||v206.z!==v195||v206.w!==v196){
  v1.vertexAttrib4f(v205,v193,v194,v195,v196);
  v206.x=v193;
  v206.y=v194;
  v206.z=v195;
  v206.w=v196;
  }
  }
  v210=g209.location;
  v211=v10[v210];
  if(!v211.buffer){
  v1.enableVertexAttribArray(v210);
  }
  if(v211.type!==5126||v211.size!==1||v211.buffer!==g208||v211.normalized!==false||v211.offset!==0||v211.stride!==8){
  v1.bindBuffer(34962,g208.buffer);
  v1.vertexAttribPointer(v210,1,5126,false,8,0);
  v211.type=5126;
  v211.size=1;
  v211.buffer=g208;
  v211.normalized=false;
  v211.offset=0;
  v211.stride=8;
  }
  if(v211.divisor!==0){
  v112.vertexAttribDivisorANGLE(v210,0);
  v211.divisor=0;
  }
  v213=g212.location;
  v214=v10[v213];
  if(!v214.buffer){
  v1.enableVertexAttribArray(v213);
  }
  if(v214.type!==5126||v214.size!==1||v214.buffer!==g208||v214.normalized!==false||v214.offset!==4||v214.stride!==8){
  v1.bindBuffer(34962,g208.buffer);
  v1.vertexAttribPointer(v213,1,5126,false,8,4);
  v214.type=5126;
  v214.size=1;
  v214.buffer=g208;
  v214.normalized=false;
  v214.offset=4;
  v214.stride=8;
  }
  if(v214.divisor!==0){
  v112.vertexAttribDivisorANGLE(v213,0);
  v214.divisor=0;
  }
  v216=a0["dashLength"];
  if(!(typeof v216==="number"))g18.commandRaise(g217,g19);
  v1.uniform1f(g215.location,v216);
  v219=a0["dashTexture"];
  if(v219&&v219._reglType==="framebuffer"){
  v219=v219.color[0];
  }
  if(!(typeof v219==="function"&&v219._reglType==="texture2d"))g18.commandRaise(g220,g19);
  v221=v219._texture;
  v1.uniform1i(g218.location,v221.bind());
  v223=a0["depth"];
  if(!(typeof v223==="number"))g18.commandRaise(g224,g19);
  v1.uniform1f(g222.location,v223);
  v226=a0["opacity"];
  if(!(typeof v226==="number"))g18.commandRaise(g227,g19);
  v1.uniform1f(g225.location,v226);
  v229=a0["scale"];
  if(!(v17(v229)&&v229.length===2))g18.commandRaise(g230,g19);
  v231=v229[0];
  v232=v229[1];
  v1.uniform2f(g228.location,v231,v232);
  v234=a0["scaleFract"];
  if(!(v17(v234)&&v234.length===2))g18.commandRaise(g235,g19);
  v236=v234[0];
  v237=v234[1];
  v1.uniform2f(g233.location,v236,v237);
  v239=a0["thickness"];
  if(!(typeof v239==="number"))g18.commandRaise(g240,g19);
  v1.uniform1f(g238.location,v239);
  v242=a0["translate"];
  if(!(v17(v242)&&v242.length===2))g18.commandRaise(g243,g19);
  v244=v242[0];
  v245=v242[1];
  v1.uniform2f(g241.location,v244,v245);
  v247=a0["translateFract"];
  if(!(v17(v247)&&v247.length===2))g18.commandRaise(g248,g19);
  v249=v247[0];
  v250=v247[1];
  v1.uniform2f(g246.location,v249,v250);
  v253=g252.call(this,v2,a0,0);
  if(!(v17(v253)&&v253.length===4))g18.commandRaise(g254,g19);
  v255=v253[0];
  v256=v253[1];
  v257=v253[2];
  v258=v253[3];
  v1.uniform4f(g251.location,v255,v256,v257,v258);
  v259=v6.elements;
  if(v259){
  v1.bindBuffer(34963,v259.buffer.buffer);
  }
  else if(v11.currentVAO){
  v259=v7.getElements(v11.currentVAO.elements);
  if(v259)v1.bindBuffer(34963,v259.buffer.buffer);
  }
  v260=a0["count"];
  if(v260>0){
  if(v259){
  v112.drawElementsInstancedANGLE(5,4,v259.type,0<<((v259.type-5121)>>1),v260);
  }
  else{
  v112.drawArraysInstancedANGLE(5,0,4,v260);
  }
  }
  else if(v260<0){
  if(v259){
  v1.drawElements(5,4,v259.type,0<<((v259.type-5121)>>1));
  }
  else{
  v1.drawArrays(5,0,4);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v98;
  v2.viewportHeight=v99;
  if(v109){
  g52.cpuTime+=performance.now()-v110;
  }
  if(v115){
  v8.destroyStream(v121);
  }
  if(v134){
  v8.destroyStream(v140);
  }
  if(v153){
  v8.destroyStream(v159);
  }
  if(v172){
  v8.destroyStream(v178);
  }
  if(v191){
  v8.destroyStream(v197);
  }
  v221.unbind();
  }
  ,"scope":function(a0,a1,a2){
  var v261,v262,v263,v264,v265,v266,v267,v268,v269,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v290,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v301,v302,v304,v305,v306,v307,v308,v309,v310,v311,v312,v313,v314,v315,v316,v317,v318,v319,v320,v321,v322,v323,v324,v325,v326,v327,v328,v329,v330,v331,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v346,v347,v348,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v373,v374,v375,v376,v377,v378,v379,v380,v381,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v400,v401,v402,v403,v404,v405,v406,v407,v408,v409,v410,v411,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v427,v428,v429,v430,v431,v432,v433,v434,v435,v436,v437,v438,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v449,v450,v451,v452,v454,v455,v456,v457,v458,v459,v460,v461,v462,v463,v464,v465,v466,v467,v468,v469,v470,v471,v472,v473,v474,v475,v476,v477,v478,v479,v481,v482,v483,v484,v485,v486,v487,v488,v489,v490,v491,v492,v493,v494;
  v261=a0["viewport"];
  if(!(v261&&typeof v261==="object"))g18.commandRaise(g93,g19);
  v262=v261.x|0;
  v263=v261.y|0;
  v264="width" in v261?v261.width|0:(v2.framebufferWidth-v262);
  v265="height" in v261?v261.height|0:(v2.framebufferHeight-v263);
  if(!(v264>=0&&v265>=0))g18.commandRaise(g93,g19);
  v266=v2.viewportWidth;
  v2.viewportWidth=v264;
  v267=v2.viewportHeight;
  v2.viewportHeight=v265;
  v268=v42[0];
  v42[0]=_gs[6];
  v269=v42[1];
  v42[1]=_gs[7];
  v270=v42[2];
  v42[2]=_gs[8];
  v271=v42[3];
  v42[3]=_gs[9];
  v272=v20[0];
  v20[0]=_gs[10];
  v273=v20[1];
  v20[1]=_gs[11];
  v274=v20[2];
  v20[2]=_gs[12];
  v275=v20[3];
  v20[3]=_gs[13];
  v276=v4.blend_enable;
  v4.blend_enable=_gs[14];
  v277=v22[0];
  v22[0]=_gs[15];
  v278=v22[1];
  v22[1]=_gs[16];
  v279=v24[0];
  v24[0]=_gs[17];
  v280=v24[1];
  v24[1]=_gs[18];
  v281=v24[2];
  v24[2]=_gs[19];
  v282=v24[3];
  v24[3]=_gs[20];
  v283=g100.call(this,v2,a0,a2);
  if(!(typeof v283==="boolean"))g18.commandRaise(g102,g19);
  v284=v4.depth_enable;
  v4.depth_enable=_gs[21];
  v285=a0["viewport"];
  if(!(v285&&typeof v285==="object"))g18.commandRaise(g104,g19);
  v286=v285.x|0;
  v287=v285.y|0;
  v288="width" in v285?v285.width|0:(v2.framebufferWidth-v286);
  v289="height" in v285?v285.height|0:(v2.framebufferHeight-v287);
  if(!(v288>=0&&v289>=0))g18.commandRaise(g104,g19);
  v290=v40[0];
  v40[0]=_gs[22];
  v291=v40[1];
  v40[1]=_gs[23];
  v292=v40[2];
  v40[2]=_gs[24];
  v293=v40[3];
  v40[3]=_gs[25];
  v294=v4.scissor_enable;
  v4.scissor_enable=_gs[26];
  v295=v4.stencil_enable;
  v4.stencil_enable=_gs[27];
  v296=v5.profile;
  if(v296){
  v297=performance.now();
  g52.count++;
  }
  v298=v6.offset;
  v6.offset=_gs[28];
  v299=v6.count;
  v6.count=_gs[29];
  v300=a0["count"];
  v301=v6.instances;
  v6.instances=_gs[30];
  v302=v6.primitive;
  v6.primitive=_gs[31];
  v304=g303.call(this,v2,a0,a2);
  v305=v12[_gs[32]];
  v12[_gs[32]]=v304;
  v306=a0["miterLimit"];
  v307=v12[_gs[33]];
  v12[_gs[33]]=v306;
  v308=a0["scale"];
  v309=v12[_gs[34]];
  v12[_gs[34]]=v308;
  v310=a0["scaleFract"];
  v311=v12[_gs[35]];
  v12[_gs[35]]=v310;
  v312=a0["translateFract"];
  v313=v12[_gs[36]];
  v12[_gs[36]]=v312;
  v314=a0["translate"];
  v315=v12[_gs[37]];
  v12[_gs[37]]=v314;
  v316=a0["thickness"];
  v317=v12[_gs[38]];
  v12[_gs[38]]=v316;
  v318=a0["dashTexture"];
  v319=v12[_gs[39]];
  v12[_gs[39]]=v318;
  v320=a0["opacity"];
  v321=v12[_gs[40]];
  v12[_gs[40]]=v320;
  v322=v2["pixelRatio"];
  v323=v12[_gs[41]];
  v12[_gs[41]]=v322;
  v324=a0["id"];
  v325=v12[_gs[42]];
  v12[_gs[42]]=v324;
  v326=a0["dashLength"];
  v327=v12[_gs[43]];
  v12[_gs[43]]=v326;
  v328=g252.call(this,v2,a0,a2);
  v329=v12[_gs[44]];
  v12[_gs[44]]=v328;
  v330=a0["depth"];
  v331=v12[_gs[45]];
  v12[_gs[45]]=v330;
  v333=g332.state;
  g332.state=1;
  v334=g332.x;
  g332.x=0;
  v335=g332.y;
  g332.y=0;
  v336=g332.z;
  g332.z=0;
  v337=g332.w;
  g332.w=0;
  v338=g332.buffer;
  g332.buffer=g208;
  v339=g332.size;
  g332.size=0;
  v340=g332.normalized;
  g332.normalized=false;
  v341=g332.type;
  g332.type=5126;
  v342=g332.offset;
  g332.offset=0;
  v343=g332.stride;
  g332.stride=8;
  v344=g332.divisor;
  g332.divisor=0;
  v346=g345.state;
  g345.state=1;
  v347=g345.x;
  g345.x=0;
  v348=g345.y;
  g345.y=0;
  v349=g345.z;
  g345.z=0;
  v350=g345.w;
  g345.w=0;
  v351=g345.buffer;
  g345.buffer=g208;
  v352=g345.size;
  g345.size=0;
  v353=g345.normalized;
  g345.normalized=false;
  v354=g345.type;
  g345.type=5126;
  v355=g345.offset;
  g345.offset=4;
  v356=g345.stride;
  g345.stride=8;
  v357=g345.divisor;
  g345.divisor=0;
  v358=a0["positionBuffer"];
  v53.buffer=v358;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g114,g19);
  v359=false;
  v360=1;
  v361=0;
  v362=0;
  v363=0;
  v364=0;
  v365=null;
  v366=0;
  v367=false;
  v368=5126;
  v369=0;
  v370=0;
  v371=0;
  if(v16(v53)){
  v359=true;
  v365=v8.createStream(34962,v53);
  v368=v365.dtype;
  }
  else{
  v365=v8.getBuffer(v53);
  if(v365){
  v368=v365.dtype;
  }
  else if("constant" in v53){
  v360=2;
  if(typeof v53.constant === "number"){
  v361=v53.constant;
  v362=v363=v364=0;
  }
  else{
  v361=v53.constant.length>0?v53.constant[0]:0;
  v362=v53.constant.length>1?v53.constant[1]:0;
  v363=v53.constant.length>2?v53.constant[2]:0;
  v364=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v365=v8.createStream(34962,v53.buffer);
  }
  else{
  v365=v8.getBuffer(v53.buffer);
  }
  v368="type" in v53?v49[v53.type]:v365.dtype;
  v367=!!v53.normalized;
  v366=v53.size|0;
  v369=v53.offset|0;
  v370=v53.stride|0;
  v371=v53.divisor|0;
  }
  }
  v373=g372.state;
  g372.state=v360;
  v374=g372.x;
  g372.x=v361;
  v375=g372.y;
  g372.y=v362;
  v376=g372.z;
  g372.z=v363;
  v377=g372.w;
  g372.w=v364;
  v378=g372.buffer;
  g372.buffer=v365;
  v379=g372.size;
  g372.size=v366;
  v380=g372.normalized;
  g372.normalized=v367;
  v381=g372.type;
  g372.type=v368;
  v382=g372.offset;
  g372.offset=v369;
  v383=g372.stride;
  g372.stride=v370;
  v384=g372.divisor;
  g372.divisor=v371;
  v385=a0["positionBuffer"];
  v54.buffer=v385;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g152,g19);
  v386=false;
  v387=1;
  v388=0;
  v389=0;
  v390=0;
  v391=0;
  v392=null;
  v393=0;
  v394=false;
  v395=5126;
  v396=0;
  v397=0;
  v398=0;
  if(v16(v54)){
  v386=true;
  v392=v8.createStream(34962,v54);
  v395=v392.dtype;
  }
  else{
  v392=v8.getBuffer(v54);
  if(v392){
  v395=v392.dtype;
  }
  else if("constant" in v54){
  v387=2;
  if(typeof v54.constant === "number"){
  v388=v54.constant;
  v389=v390=v391=0;
  }
  else{
  v388=v54.constant.length>0?v54.constant[0]:0;
  v389=v54.constant.length>1?v54.constant[1]:0;
  v390=v54.constant.length>2?v54.constant[2]:0;
  v391=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v392=v8.createStream(34962,v54.buffer);
  }
  else{
  v392=v8.getBuffer(v54.buffer);
  }
  v395="type" in v54?v49[v54.type]:v392.dtype;
  v394=!!v54.normalized;
  v393=v54.size|0;
  v396=v54.offset|0;
  v397=v54.stride|0;
  v398=v54.divisor|0;
  }
  }
  v400=g399.state;
  g399.state=v387;
  v401=g399.x;
  g399.x=v388;
  v402=g399.y;
  g399.y=v389;
  v403=g399.z;
  g399.z=v390;
  v404=g399.w;
  g399.w=v391;
  v405=g399.buffer;
  g399.buffer=v392;
  v406=g399.size;
  g399.size=v393;
  v407=g399.normalized;
  g399.normalized=v394;
  v408=g399.type;
  g399.type=v395;
  v409=g399.offset;
  g399.offset=v396;
  v410=g399.stride;
  g399.stride=v397;
  v411=g399.divisor;
  g399.divisor=v398;
  v412=a0["positionFractBuffer"];
  v55.buffer=v412;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g133,g19);
  v413=false;
  v414=1;
  v415=0;
  v416=0;
  v417=0;
  v418=0;
  v419=null;
  v420=0;
  v421=false;
  v422=5126;
  v423=0;
  v424=0;
  v425=0;
  if(v16(v55)){
  v413=true;
  v419=v8.createStream(34962,v55);
  v422=v419.dtype;
  }
  else{
  v419=v8.getBuffer(v55);
  if(v419){
  v422=v419.dtype;
  }
  else if("constant" in v55){
  v414=2;
  if(typeof v55.constant === "number"){
  v415=v55.constant;
  v416=v417=v418=0;
  }
  else{
  v415=v55.constant.length>0?v55.constant[0]:0;
  v416=v55.constant.length>1?v55.constant[1]:0;
  v417=v55.constant.length>2?v55.constant[2]:0;
  v418=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v419=v8.createStream(34962,v55.buffer);
  }
  else{
  v419=v8.getBuffer(v55.buffer);
  }
  v422="type" in v55?v49[v55.type]:v419.dtype;
  v421=!!v55.normalized;
  v420=v55.size|0;
  v423=v55.offset|0;
  v424=v55.stride|0;
  v425=v55.divisor|0;
  }
  }
  v427=g426.state;
  g426.state=v414;
  v428=g426.x;
  g426.x=v415;
  v429=g426.y;
  g426.y=v416;
  v430=g426.z;
  g426.z=v417;
  v431=g426.w;
  g426.w=v418;
  v432=g426.buffer;
  g426.buffer=v419;
  v433=g426.size;
  g426.size=v420;
  v434=g426.normalized;
  g426.normalized=v421;
  v435=g426.type;
  g426.type=v422;
  v436=g426.offset;
  g426.offset=v423;
  v437=g426.stride;
  g426.stride=v424;
  v438=g426.divisor;
  g426.divisor=v425;
  v439=a0["positionFractBuffer"];
  v56.buffer=v439;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g171,g19);
  v440=false;
  v441=1;
  v442=0;
  v443=0;
  v444=0;
  v445=0;
  v446=null;
  v447=0;
  v448=false;
  v449=5126;
  v450=0;
  v451=0;
  v452=0;
  if(v16(v56)){
  v440=true;
  v446=v8.createStream(34962,v56);
  v449=v446.dtype;
  }
  else{
  v446=v8.getBuffer(v56);
  if(v446){
  v449=v446.dtype;
  }
  else if("constant" in v56){
  v441=2;
  if(typeof v56.constant === "number"){
  v442=v56.constant;
  v443=v444=v445=0;
  }
  else{
  v442=v56.constant.length>0?v56.constant[0]:0;
  v443=v56.constant.length>1?v56.constant[1]:0;
  v444=v56.constant.length>2?v56.constant[2]:0;
  v445=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v446=v8.createStream(34962,v56.buffer);
  }
  else{
  v446=v8.getBuffer(v56.buffer);
  }
  v449="type" in v56?v49[v56.type]:v446.dtype;
  v448=!!v56.normalized;
  v447=v56.size|0;
  v450=v56.offset|0;
  v451=v56.stride|0;
  v452=v56.divisor|0;
  }
  }
  v454=g453.state;
  g453.state=v441;
  v455=g453.x;
  g453.x=v442;
  v456=g453.y;
  g453.y=v443;
  v457=g453.z;
  g453.z=v444;
  v458=g453.w;
  g453.w=v445;
  v459=g453.buffer;
  g453.buffer=v446;
  v460=g453.size;
  g453.size=v447;
  v461=g453.normalized;
  g453.normalized=v448;
  v462=g453.type;
  g453.type=v449;
  v463=g453.offset;
  g453.offset=v450;
  v464=g453.stride;
  g453.stride=v451;
  v465=g453.divisor;
  g453.divisor=v452;
  v466=a0["colorBuffer"];
  v57.buffer=v466;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g190,g19);
  v467=false;
  v468=1;
  v469=0;
  v470=0;
  v471=0;
  v472=0;
  v473=null;
  v474=0;
  v475=false;
  v476=5126;
  v477=0;
  v478=0;
  v479=0;
  if(v16(v57)){
  v467=true;
  v473=v8.createStream(34962,v57);
  v476=v473.dtype;
  }
  else{
  v473=v8.getBuffer(v57);
  if(v473){
  v476=v473.dtype;
  }
  else if("constant" in v57){
  v468=2;
  if(typeof v57.constant === "number"){
  v469=v57.constant;
  v470=v471=v472=0;
  }
  else{
  v469=v57.constant.length>0?v57.constant[0]:0;
  v470=v57.constant.length>1?v57.constant[1]:0;
  v471=v57.constant.length>2?v57.constant[2]:0;
  v472=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v473=v8.createStream(34962,v57.buffer);
  }
  else{
  v473=v8.getBuffer(v57.buffer);
  }
  v476="type" in v57?v49[v57.type]:v473.dtype;
  v475=!!v57.normalized;
  v474=v57.size|0;
  v477=v57.offset|0;
  v478=v57.stride|0;
  v479=v57.divisor|0;
  }
  }
  v481=g480.state;
  g480.state=v468;
  v482=g480.x;
  g480.x=v469;
  v483=g480.y;
  g480.y=v470;
  v484=g480.z;
  g480.z=v471;
  v485=g480.w;
  g480.w=v472;
  v486=g480.buffer;
  g480.buffer=v473;
  v487=g480.size;
  g480.size=v474;
  v488=g480.normalized;
  g480.normalized=v475;
  v489=g480.type;
  g480.type=v476;
  v490=g480.offset;
  g480.offset=v477;
  v491=g480.stride;
  g480.stride=v478;
  v492=g480.divisor;
  g480.divisor=v479;
  v493=v9.vert;
  v9.vert=_gs[46];
  v494=v9.frag;
  v9.frag=_gs[47];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v266;
  v2.viewportHeight=v267;
  v42[0]=v268;
  v42[1]=v269;
  v42[2]=v270;
  v42[3]=v271;
  v20[0]=v272;
  v20[1]=v273;
  v20[2]=v274;
  v20[3]=v275;
  v4.blend_enable=v276;
  v22[0]=v277;
  v22[1]=v278;
  v24[0]=v279;
  v24[1]=v280;
  v24[2]=v281;
  v24[3]=v282;
  v4.depth_enable=v284;
  v40[0]=v290;
  v40[1]=v291;
  v40[2]=v292;
  v40[3]=v293;
  v4.scissor_enable=v294;
  v4.stencil_enable=v295;
  if(v296){
  g52.cpuTime+=performance.now()-v297;
  }
  v6.offset=v298;
  v6.count=v299;
  v6.instances=v301;
  v6.primitive=v302;
  v12[_gs[32]]=v305;
  v12[_gs[33]]=v307;
  v12[_gs[34]]=v309;
  v12[_gs[35]]=v311;
  v12[_gs[36]]=v313;
  v12[_gs[37]]=v315;
  v12[_gs[38]]=v317;
  v12[_gs[39]]=v319;
  v12[_gs[40]]=v321;
  v12[_gs[41]]=v323;
  v12[_gs[42]]=v325;
  v12[_gs[43]]=v327;
  v12[_gs[44]]=v329;
  v12[_gs[45]]=v331;
  g332.state=v333;
  g332.x=v334;
  g332.y=v335;
  g332.z=v336;
  g332.w=v337;
  g332.buffer=v338;
  g332.size=v339;
  g332.normalized=v340;
  g332.type=v341;
  g332.offset=v342;
  g332.stride=v343;
  g332.divisor=v344;
  g345.state=v346;
  g345.x=v347;
  g345.y=v348;
  g345.z=v349;
  g345.w=v350;
  g345.buffer=v351;
  g345.size=v352;
  g345.normalized=v353;
  g345.type=v354;
  g345.offset=v355;
  g345.stride=v356;
  g345.divisor=v357;
  if(v359){
  v8.destroyStream(v365);
  }
  g372.state=v373;
  g372.x=v374;
  g372.y=v375;
  g372.z=v376;
  g372.w=v377;
  g372.buffer=v378;
  g372.size=v379;
  g372.normalized=v380;
  g372.type=v381;
  g372.offset=v382;
  g372.stride=v383;
  g372.divisor=v384;
  if(v386){
  v8.destroyStream(v392);
  }
  g399.state=v400;
  g399.x=v401;
  g399.y=v402;
  g399.z=v403;
  g399.w=v404;
  g399.buffer=v405;
  g399.size=v406;
  g399.normalized=v407;
  g399.type=v408;
  g399.offset=v409;
  g399.stride=v410;
  g399.divisor=v411;
  if(v413){
  v8.destroyStream(v419);
  }
  g426.state=v427;
  g426.x=v428;
  g426.y=v429;
  g426.z=v430;
  g426.w=v431;
  g426.buffer=v432;
  g426.size=v433;
  g426.normalized=v434;
  g426.type=v435;
  g426.offset=v436;
  g426.stride=v437;
  g426.divisor=v438;
  if(v440){
  v8.destroyStream(v446);
  }
  g453.state=v454;
  g453.x=v455;
  g453.y=v456;
  g453.z=v457;
  g453.w=v458;
  g453.buffer=v459;
  g453.size=v460;
  g453.normalized=v461;
  g453.type=v462;
  g453.offset=v463;
  g453.stride=v464;
  g453.divisor=v465;
  if(v467){
  v8.destroyStream(v473);
  }
  g480.state=v481;
  g480.x=v482;
  g480.y=v483;
  g480.z=v484;
  g480.w=v485;
  g480.buffer=v486;
  g480.size=v487;
  g480.normalized=v488;
  g480.type=v489;
  g480.offset=v490;
  g480.stride=v491;
  g480.divisor=v492;
  v9.vert=v493;
  v9.frag=v494;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v495,v496,v529,v530,v531,v532,v533;
  v495=v14.angle_instanced_arrays;
  v496=v13.next;
  if(v496!==v13.cur){
  if(v496){
  v1.bindFramebuffer(36160,v496.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v496;
  }
  if(v5.dirty){
  var v497,v498,v499,v500,v501,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v514,v515,v516,v517,v518,v519,v520,v521,v522,v523,v524,v525,v526,v527,v528;
  v497=v4.dither;
  if(v497!==v5.dither){
  if(v497){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v497;
  }
  v498=v4.depth_func;
  if(v498!==v5.depth_func){
  v1.depthFunc(v498);
  v5.depth_func=v498;
  }
  v499=v26[0];
  v500=v26[1];
  if(v499!==v27[0]||v500!==v27[1]){
  v1.depthRange(v499,v500);
  v27[0]=v499;
  v27[1]=v500;
  }
  v501=v4.depth_mask;
  if(v501!==v5.depth_mask){
  v1.depthMask(v501);
  v5.depth_mask=v501;
  }
  v502=v28[0];
  v503=v28[1];
  v504=v28[2];
  v505=v28[3];
  if(v502!==v29[0]||v503!==v29[1]||v504!==v29[2]||v505!==v29[3]){
  v1.colorMask(v502,v503,v504,v505);
  v29[0]=v502;
  v29[1]=v503;
  v29[2]=v504;
  v29[3]=v505;
  }
  v506=v4.cull_enable;
  if(v506!==v5.cull_enable){
  if(v506){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v506;
  }
  v507=v4.cull_face;
  if(v507!==v5.cull_face){
  v1.cullFace(v507);
  v5.cull_face=v507;
  }
  v508=v4.frontFace;
  if(v508!==v5.frontFace){
  v1.frontFace(v508);
  v5.frontFace=v508;
  }
  v509=v4.lineWidth;
  if(v509!==v5.lineWidth){
  v1.lineWidth(v509);
  v5.lineWidth=v509;
  }
  v510=v4.polygonOffset_enable;
  if(v510!==v5.polygonOffset_enable){
  if(v510){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v510;
  }
  v511=v30[0];
  v512=v30[1];
  if(v511!==v31[0]||v512!==v31[1]){
  v1.polygonOffset(v511,v512);
  v31[0]=v511;
  v31[1]=v512;
  }
  v513=v4.sample_alpha;
  if(v513!==v5.sample_alpha){
  if(v513){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v513;
  }
  v514=v4.sample_enable;
  if(v514!==v5.sample_enable){
  if(v514){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v514;
  }
  v515=v32[0];
  v516=v32[1];
  if(v515!==v33[0]||v516!==v33[1]){
  v1.sampleCoverage(v515,v516);
  v33[0]=v515;
  v33[1]=v516;
  }
  v517=v4.stencil_mask;
  if(v517!==v5.stencil_mask){
  v1.stencilMask(v517);
  v5.stencil_mask=v517;
  }
  v518=v34[0];
  v519=v34[1];
  v520=v34[2];
  if(v518!==v35[0]||v519!==v35[1]||v520!==v35[2]){
  v1.stencilFunc(v518,v519,v520);
  v35[0]=v518;
  v35[1]=v519;
  v35[2]=v520;
  }
  v521=v36[0];
  v522=v36[1];
  v523=v36[2];
  v524=v36[3];
  if(v521!==v37[0]||v522!==v37[1]||v523!==v37[2]||v524!==v37[3]){
  v1.stencilOpSeparate(v521,v522,v523,v524);
  v37[0]=v521;
  v37[1]=v522;
  v37[2]=v523;
  v37[3]=v524;
  }
  v525=v38[0];
  v526=v38[1];
  v527=v38[2];
  v528=v38[3];
  if(v525!==v39[0]||v526!==v39[1]||v527!==v39[2]||v528!==v39[3]){
  v1.stencilOpSeparate(v525,v526,v527,v528);
  v39[0]=v525;
  v39[1]=v526;
  v39[2]=v527;
  v39[3]=v528;
  }
  }
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[48]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[49];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[50]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[51];
  if(_gs[52]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[53];
  v529=v5.profile;
  if(v529){
  v530=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g111.program);
  v531=v14.angle_instanced_arrays;
  var v547,v548,v549,v550,v675;
  v11.setVAO(null);
  v547=g209.location;
  v548=v10[v547];
  if(!v548.buffer){
  v1.enableVertexAttribArray(v547);
  }
  if(v548.type!==5126||v548.size!==1||v548.buffer!==g208||v548.normalized!==false||v548.offset!==0||v548.stride!==8){
  v1.bindBuffer(34962,g208.buffer);
  v1.vertexAttribPointer(v547,1,5126,false,8,0);
  v548.type=5126;
  v548.size=1;
  v548.buffer=g208;
  v548.normalized=false;
  v548.offset=0;
  v548.stride=8;
  }
  if(v548.divisor!==0){
  v531.vertexAttribDivisorANGLE(v547,0);
  v548.divisor=0;
  }
  v549=g212.location;
  v550=v10[v549];
  if(!v550.buffer){
  v1.enableVertexAttribArray(v549);
  }
  if(v550.type!==5126||v550.size!==1||v550.buffer!==g208||v550.normalized!==false||v550.offset!==4||v550.stride!==8){
  v1.bindBuffer(34962,g208.buffer);
  v1.vertexAttribPointer(v549,1,5126,false,8,4);
  v550.type=5126;
  v550.size=1;
  v550.buffer=g208;
  v550.normalized=false;
  v550.offset=4;
  v550.stride=8;
  }
  if(v550.divisor!==0){
  v531.vertexAttribDivisorANGLE(v549,0);
  v550.divisor=0;
  }
  v675=v6.elements;
  if(v675){
  v1.bindBuffer(34963,v675.buffer.buffer);
  }
  else if(v11.currentVAO){
  v675=v7.getElements(v11.currentVAO.elements);
  if(v675)v1.bindBuffer(34963,v675.buffer.buffer);
  }
  for(v532=0;
  v532<a1;
  ++v532){
  v533=a0[v532];
  var v534,v535,v536,v537,v538,v539,v540,v541,v542,v543,v544,v545,v546,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v569,v570,v571,v572,v573,v574,v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v586,v587,v588,v589,v590,v591,v592,v593,v594,v595,v596,v597,v598,v599,v600,v601,v602,v603,v604,v605,v606,v607,v608,v609,v610,v611,v612,v613,v614,v615,v616,v617,v618,v619,v620,v621,v622,v623,v624,v625,v626,v627,v628,v629,v630,v631,v632,v633,v634,v635,v636,v637,v638,v639,v640,v641,v642,v643,v644,v645,v646,v647,v648,v649,v650,v651,v652,v653,v654,v655,v656,v657,v658,v659,v660,v661,v662,v663,v664,v665,v666,v667,v668,v669,v670,v671,v672,v673,v674,v676;
  v534=v533["viewport"];
  if(!(v534&&typeof v534==="object"))g18.commandRaise(g93,g19);
  v535=v534.x|0;
  v536=v534.y|0;
  v537="width" in v534?v534.width|0:(v2.framebufferWidth-v535);
  v538="height" in v534?v534.height|0:(v2.framebufferHeight-v536);
  if(!(v537>=0&&v538>=0))g18.commandRaise(g93,g19);
  v539=v2.viewportWidth;
  v2.viewportWidth=v537;
  v540=v2.viewportHeight;
  v2.viewportHeight=v538;
  v1.viewport(v535,v536,v537,v538);
  v43[0]=v535;
  v43[1]=v536;
  v43[2]=v537;
  v43[3]=v538;
  v541=g100.call(this,v2,v533,v532);
  if(!(typeof v541==="boolean"))g18.commandRaise(g102,g19);
  if(v541){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v541;
  v542=v533["viewport"];
  if(!(v542&&typeof v542==="object"))g18.commandRaise(g104,g19);
  v543=v542.x|0;
  v544=v542.y|0;
  v545="width" in v542?v542.width|0:(v2.framebufferWidth-v543);
  v546="height" in v542?v542.height|0:(v2.framebufferHeight-v544);
  if(!(v545>=0&&v546>=0))g18.commandRaise(g104,g19);
  v1.scissor(v543,v544,v545,v546);
  v41[0]=v543;
  v41[1]=v544;
  v41[2]=v545;
  v41[3]=v546;
  v551=v533["positionBuffer"];
  v53.buffer=v551;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g114,g19);
  v552=false;
  v553=1;
  v554=0;
  v555=0;
  v556=0;
  v557=0;
  v558=null;
  v559=0;
  v560=false;
  v561=5126;
  v562=0;
  v563=0;
  v564=0;
  if(v16(v53)){
  v552=true;
  v558=v8.createStream(34962,v53);
  v561=v558.dtype;
  }
  else{
  v558=v8.getBuffer(v53);
  if(v558){
  v561=v558.dtype;
  }
  else if("constant" in v53){
  v553=2;
  if(typeof v53.constant === "number"){
  v554=v53.constant;
  v555=v556=v557=0;
  }
  else{
  v554=v53.constant.length>0?v53.constant[0]:0;
  v555=v53.constant.length>1?v53.constant[1]:0;
  v556=v53.constant.length>2?v53.constant[2]:0;
  v557=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v558=v8.createStream(34962,v53.buffer);
  }
  else{
  v558=v8.getBuffer(v53.buffer);
  }
  v561="type" in v53?v49[v53.type]:v558.dtype;
  v560=!!v53.normalized;
  v559=v53.size|0;
  v562=v53.offset|0;
  v563=v53.stride|0;
  v564=v53.divisor|0;
  }
  }
  v565=g128.location;
  v566=v10[v565];
  if(v553===1){
  if(!v566.buffer){
  v1.enableVertexAttribArray(v565);
  }
  v567=v559||2;
  if(v566.type!==v561||v566.size!==v567||v566.buffer!==v558||v566.normalized!==v560||v566.offset!==v562||v566.stride!==v563){
  v1.bindBuffer(34962,v558.buffer);
  v1.vertexAttribPointer(v565,v567,v561,v560,v563,v562);
  v566.type=v561;
  v566.size=v567;
  v566.buffer=v558;
  v566.normalized=v560;
  v566.offset=v562;
  v566.stride=v563;
  }
  if(v566.divisor!==v564){
  v531.vertexAttribDivisorANGLE(v565,v564);
  v566.divisor=v564;
  }
  }
  else{
  if(v566.buffer){
  v1.disableVertexAttribArray(v565);
  v566.buffer=null;
  }
  if(v566.x!==v554||v566.y!==v555||v566.z!==v556||v566.w!==v557){
  v1.vertexAttrib4f(v565,v554,v555,v556,v557);
  v566.x=v554;
  v566.y=v555;
  v566.z=v556;
  v566.w=v557;
  }
  }
  v568=v533["positionFractBuffer"];
  v55.buffer=v568;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g133,g19);
  v569=false;
  v570=1;
  v571=0;
  v572=0;
  v573=0;
  v574=0;
  v575=null;
  v576=0;
  v577=false;
  v578=5126;
  v579=0;
  v580=0;
  v581=0;
  if(v16(v55)){
  v569=true;
  v575=v8.createStream(34962,v55);
  v578=v575.dtype;
  }
  else{
  v575=v8.getBuffer(v55);
  if(v575){
  v578=v575.dtype;
  }
  else if("constant" in v55){
  v570=2;
  if(typeof v55.constant === "number"){
  v571=v55.constant;
  v572=v573=v574=0;
  }
  else{
  v571=v55.constant.length>0?v55.constant[0]:0;
  v572=v55.constant.length>1?v55.constant[1]:0;
  v573=v55.constant.length>2?v55.constant[2]:0;
  v574=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v575=v8.createStream(34962,v55.buffer);
  }
  else{
  v575=v8.getBuffer(v55.buffer);
  }
  v578="type" in v55?v49[v55.type]:v575.dtype;
  v577=!!v55.normalized;
  v576=v55.size|0;
  v579=v55.offset|0;
  v580=v55.stride|0;
  v581=v55.divisor|0;
  }
  }
  v582=g147.location;
  v583=v10[v582];
  if(v570===1){
  if(!v583.buffer){
  v1.enableVertexAttribArray(v582);
  }
  v584=v576||2;
  if(v583.type!==v578||v583.size!==v584||v583.buffer!==v575||v583.normalized!==v577||v583.offset!==v579||v583.stride!==v580){
  v1.bindBuffer(34962,v575.buffer);
  v1.vertexAttribPointer(v582,v584,v578,v577,v580,v579);
  v583.type=v578;
  v583.size=v584;
  v583.buffer=v575;
  v583.normalized=v577;
  v583.offset=v579;
  v583.stride=v580;
  }
  if(v583.divisor!==v581){
  v531.vertexAttribDivisorANGLE(v582,v581);
  v583.divisor=v581;
  }
  }
  else{
  if(v583.buffer){
  v1.disableVertexAttribArray(v582);
  v583.buffer=null;
  }
  if(v583.x!==v571||v583.y!==v572||v583.z!==v573||v583.w!==v574){
  v1.vertexAttrib4f(v582,v571,v572,v573,v574);
  v583.x=v571;
  v583.y=v572;
  v583.z=v573;
  v583.w=v574;
  }
  }
  v585=v533["positionBuffer"];
  v54.buffer=v585;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g152,g19);
  v586=false;
  v587=1;
  v588=0;
  v589=0;
  v590=0;
  v591=0;
  v592=null;
  v593=0;
  v594=false;
  v595=5126;
  v596=0;
  v597=0;
  v598=0;
  if(v16(v54)){
  v586=true;
  v592=v8.createStream(34962,v54);
  v595=v592.dtype;
  }
  else{
  v592=v8.getBuffer(v54);
  if(v592){
  v595=v592.dtype;
  }
  else if("constant" in v54){
  v587=2;
  if(typeof v54.constant === "number"){
  v588=v54.constant;
  v589=v590=v591=0;
  }
  else{
  v588=v54.constant.length>0?v54.constant[0]:0;
  v589=v54.constant.length>1?v54.constant[1]:0;
  v590=v54.constant.length>2?v54.constant[2]:0;
  v591=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v592=v8.createStream(34962,v54.buffer);
  }
  else{
  v592=v8.getBuffer(v54.buffer);
  }
  v595="type" in v54?v49[v54.type]:v592.dtype;
  v594=!!v54.normalized;
  v593=v54.size|0;
  v596=v54.offset|0;
  v597=v54.stride|0;
  v598=v54.divisor|0;
  }
  }
  v599=g166.location;
  v600=v10[v599];
  if(v587===1){
  if(!v600.buffer){
  v1.enableVertexAttribArray(v599);
  }
  v601=v593||2;
  if(v600.type!==v595||v600.size!==v601||v600.buffer!==v592||v600.normalized!==v594||v600.offset!==v596||v600.stride!==v597){
  v1.bindBuffer(34962,v592.buffer);
  v1.vertexAttribPointer(v599,v601,v595,v594,v597,v596);
  v600.type=v595;
  v600.size=v601;
  v600.buffer=v592;
  v600.normalized=v594;
  v600.offset=v596;
  v600.stride=v597;
  }
  if(v600.divisor!==v598){
  v531.vertexAttribDivisorANGLE(v599,v598);
  v600.divisor=v598;
  }
  }
  else{
  if(v600.buffer){
  v1.disableVertexAttribArray(v599);
  v600.buffer=null;
  }
  if(v600.x!==v588||v600.y!==v589||v600.z!==v590||v600.w!==v591){
  v1.vertexAttrib4f(v599,v588,v589,v590,v591);
  v600.x=v588;
  v600.y=v589;
  v600.z=v590;
  v600.w=v591;
  }
  }
  v602=v533["positionFractBuffer"];
  v56.buffer=v602;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g171,g19);
  v603=false;
  v604=1;
  v605=0;
  v606=0;
  v607=0;
  v608=0;
  v609=null;
  v610=0;
  v611=false;
  v612=5126;
  v613=0;
  v614=0;
  v615=0;
  if(v16(v56)){
  v603=true;
  v609=v8.createStream(34962,v56);
  v612=v609.dtype;
  }
  else{
  v609=v8.getBuffer(v56);
  if(v609){
  v612=v609.dtype;
  }
  else if("constant" in v56){
  v604=2;
  if(typeof v56.constant === "number"){
  v605=v56.constant;
  v606=v607=v608=0;
  }
  else{
  v605=v56.constant.length>0?v56.constant[0]:0;
  v606=v56.constant.length>1?v56.constant[1]:0;
  v607=v56.constant.length>2?v56.constant[2]:0;
  v608=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v609=v8.createStream(34962,v56.buffer);
  }
  else{
  v609=v8.getBuffer(v56.buffer);
  }
  v612="type" in v56?v49[v56.type]:v609.dtype;
  v611=!!v56.normalized;
  v610=v56.size|0;
  v613=v56.offset|0;
  v614=v56.stride|0;
  v615=v56.divisor|0;
  }
  }
  v616=g185.location;
  v617=v10[v616];
  if(v604===1){
  if(!v617.buffer){
  v1.enableVertexAttribArray(v616);
  }
  v618=v610||2;
  if(v617.type!==v612||v617.size!==v618||v617.buffer!==v609||v617.normalized!==v611||v617.offset!==v613||v617.stride!==v614){
  v1.bindBuffer(34962,v609.buffer);
  v1.vertexAttribPointer(v616,v618,v612,v611,v614,v613);
  v617.type=v612;
  v617.size=v618;
  v617.buffer=v609;
  v617.normalized=v611;
  v617.offset=v613;
  v617.stride=v614;
  }
  if(v617.divisor!==v615){
  v531.vertexAttribDivisorANGLE(v616,v615);
  v617.divisor=v615;
  }
  }
  else{
  if(v617.buffer){
  v1.disableVertexAttribArray(v616);
  v617.buffer=null;
  }
  if(v617.x!==v605||v617.y!==v606||v617.z!==v607||v617.w!==v608){
  v1.vertexAttrib4f(v616,v605,v606,v607,v608);
  v617.x=v605;
  v617.y=v606;
  v617.z=v607;
  v617.w=v608;
  }
  }
  v619=v533["colorBuffer"];
  v57.buffer=v619;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g190,g19);
  v620=false;
  v621=1;
  v622=0;
  v623=0;
  v624=0;
  v625=0;
  v626=null;
  v627=0;
  v628=false;
  v629=5126;
  v630=0;
  v631=0;
  v632=0;
  if(v16(v57)){
  v620=true;
  v626=v8.createStream(34962,v57);
  v629=v626.dtype;
  }
  else{
  v626=v8.getBuffer(v57);
  if(v626){
  v629=v626.dtype;
  }
  else if("constant" in v57){
  v621=2;
  if(typeof v57.constant === "number"){
  v622=v57.constant;
  v623=v624=v625=0;
  }
  else{
  v622=v57.constant.length>0?v57.constant[0]:0;
  v623=v57.constant.length>1?v57.constant[1]:0;
  v624=v57.constant.length>2?v57.constant[2]:0;
  v625=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v626=v8.createStream(34962,v57.buffer);
  }
  else{
  v626=v8.getBuffer(v57.buffer);
  }
  v629="type" in v57?v49[v57.type]:v626.dtype;
  v628=!!v57.normalized;
  v627=v57.size|0;
  v630=v57.offset|0;
  v631=v57.stride|0;
  v632=v57.divisor|0;
  }
  }
  v633=g204.location;
  v634=v10[v633];
  if(v621===1){
  if(!v634.buffer){
  v1.enableVertexAttribArray(v633);
  }
  v635=v627||4;
  if(v634.type!==v629||v634.size!==v635||v634.buffer!==v626||v634.normalized!==v628||v634.offset!==v630||v634.stride!==v631){
  v1.bindBuffer(34962,v626.buffer);
  v1.vertexAttribPointer(v633,v635,v629,v628,v631,v630);
  v634.type=v629;
  v634.size=v635;
  v634.buffer=v626;
  v634.normalized=v628;
  v634.offset=v630;
  v634.stride=v631;
  }
  if(v634.divisor!==v632){
  v531.vertexAttribDivisorANGLE(v633,v632);
  v634.divisor=v632;
  }
  }
  else{
  if(v634.buffer){
  v1.disableVertexAttribArray(v633);
  v634.buffer=null;
  }
  if(v634.x!==v622||v634.y!==v623||v634.z!==v624||v634.w!==v625){
  v1.vertexAttrib4f(v633,v622,v623,v624,v625);
  v634.x=v622;
  v634.y=v623;
  v634.z=v624;
  v634.w=v625;
  }
  }
  v636=v533["dashLength"];
  if(!(typeof v636==="number"))g18.commandRaise(g217,g19);
  if(!v532||v637!==v636){
  v637=v636;
  v1.uniform1f(g215.location,v636);
  }
  v638=v533["dashTexture"];
  if(v638&&v638._reglType==="framebuffer"){
  v638=v638.color[0];
  }
  if(!(typeof v638==="function"&&v638._reglType==="texture2d"))g18.commandRaise(g220,g19);
  v639=v638._texture;
  v1.uniform1i(g218.location,v639.bind());
  v640=v533["depth"];
  if(!(typeof v640==="number"))g18.commandRaise(g224,g19);
  if(!v532||v641!==v640){
  v641=v640;
  v1.uniform1f(g222.location,v640);
  }
  v642=v533["opacity"];
  if(!(typeof v642==="number"))g18.commandRaise(g227,g19);
  if(!v532||v643!==v642){
  v643=v642;
  v1.uniform1f(g225.location,v642);
  }
  v644=v533["scale"];
  if(!(v17(v644)&&v644.length===2))g18.commandRaise(g230,g19);
  v645=v644[0];
  v647=v644[1];
  if(!v532||v646!==v645||v648!==v647){
  v646=v645;
  v648=v647;
  v1.uniform2f(g228.location,v645,v647);
  }
  v649=v533["scaleFract"];
  if(!(v17(v649)&&v649.length===2))g18.commandRaise(g235,g19);
  v650=v649[0];
  v652=v649[1];
  if(!v532||v651!==v650||v653!==v652){
  v651=v650;
  v653=v652;
  v1.uniform2f(g233.location,v650,v652);
  }
  v654=v533["thickness"];
  if(!(typeof v654==="number"))g18.commandRaise(g240,g19);
  if(!v532||v655!==v654){
  v655=v654;
  v1.uniform1f(g238.location,v654);
  }
  v656=v533["translate"];
  if(!(v17(v656)&&v656.length===2))g18.commandRaise(g243,g19);
  v657=v656[0];
  v659=v656[1];
  if(!v532||v658!==v657||v660!==v659){
  v658=v657;
  v660=v659;
  v1.uniform2f(g241.location,v657,v659);
  }
  v661=v533["translateFract"];
  if(!(v17(v661)&&v661.length===2))g18.commandRaise(g248,g19);
  v662=v661[0];
  v664=v661[1];
  if(!v532||v663!==v662||v665!==v664){
  v663=v662;
  v665=v664;
  v1.uniform2f(g246.location,v662,v664);
  }
  v666=g252.call(this,v2,v533,v532);
  if(!(v17(v666)&&v666.length===4))g18.commandRaise(g254,g19);
  v667=v666[0];
  v669=v666[1];
  v671=v666[2];
  v673=v666[3];
  if(!v532||v668!==v667||v670!==v669||v672!==v671||v674!==v673){
  v668=v667;
  v670=v669;
  v672=v671;
  v674=v673;
  v1.uniform4f(g251.location,v667,v669,v671,v673);
  }
  v676=v533["count"];
  if(v676>0){
  if(v675){
  v531.drawElementsInstancedANGLE(5,4,v675.type,0<<((v675.type-5121)>>1),v676);
  }
  else{
  v531.drawArraysInstancedANGLE(5,0,4,v676);
  }
  }
  else if(v676<0){
  if(v675){
  v1.drawElements(5,4,v675.type,0<<((v675.type-5121)>>1));
  }
  else{
  v1.drawArrays(5,0,4);
  }
  }
  v2.viewportWidth=v539;
  v2.viewportHeight=v540;
  if(v552){
  v8.destroyStream(v558);
  }
  if(v569){
  v8.destroyStream(v575);
  }
  if(v586){
  v8.destroyStream(v592);
  }
  if(v603){
  v8.destroyStream(v609);
  }
  if(v620){
  v8.destroyStream(v626);
  }
  v639.unbind();
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v529){
  g52.cpuTime+=performance.now()-v530;
  }
  }
  ,}
  
  },
  "11811.24": function (_gs, g0, g18, g19, g52, g117, g184) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v114,v181;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v114={
  }
  ;
  v181={
  }
  ;
  return {
  "draw":function(a0){
  var v53,v54,v109,v110,v111,v112,v113,v115,v116;
  v53=v14.angle_instanced_arrays;
  v54=v13.next;
  if(v54!==v13.cur){
  if(v54){
  v1.bindFramebuffer(36160,v54.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v54;
  }
  if(v5.dirty){
  var v55,v56,v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95,v96,v97,v98,v99,v100,v101,v102,v103,v104,v105,v106,v107,v108;
  v55=v4.dither;
  if(v55!==v5.dither){
  if(v55){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v55;
  }
  v56=v4.blend_enable;
  if(v56!==v5.blend_enable){
  if(v56){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v56;
  }
  v57=v20[0];
  v58=v20[1];
  v59=v20[2];
  v60=v20[3];
  if(v57!==v21[0]||v58!==v21[1]||v59!==v21[2]||v60!==v21[3]){
  v1.blendColor(v57,v58,v59,v60);
  v21[0]=v57;
  v21[1]=v58;
  v21[2]=v59;
  v21[3]=v60;
  }
  v61=v22[0];
  v62=v22[1];
  if(v61!==v23[0]||v62!==v23[1]){
  v1.blendEquationSeparate(v61,v62);
  v23[0]=v61;
  v23[1]=v62;
  }
  v63=v24[0];
  v64=v24[1];
  v65=v24[2];
  v66=v24[3];
  if(v63!==v25[0]||v64!==v25[1]||v65!==v25[2]||v66!==v25[3]){
  v1.blendFuncSeparate(v63,v64,v65,v66);
  v25[0]=v63;
  v25[1]=v64;
  v25[2]=v65;
  v25[3]=v66;
  }
  v67=v4.depth_enable;
  if(v67!==v5.depth_enable){
  if(v67){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v67;
  }
  v68=v4.depth_func;
  if(v68!==v5.depth_func){
  v1.depthFunc(v68);
  v5.depth_func=v68;
  }
  v69=v26[0];
  v70=v26[1];
  if(v69!==v27[0]||v70!==v27[1]){
  v1.depthRange(v69,v70);
  v27[0]=v69;
  v27[1]=v70;
  }
  v71=v4.depth_mask;
  if(v71!==v5.depth_mask){
  v1.depthMask(v71);
  v5.depth_mask=v71;
  }
  v72=v28[0];
  v73=v28[1];
  v74=v28[2];
  v75=v28[3];
  if(v72!==v29[0]||v73!==v29[1]||v74!==v29[2]||v75!==v29[3]){
  v1.colorMask(v72,v73,v74,v75);
  v29[0]=v72;
  v29[1]=v73;
  v29[2]=v74;
  v29[3]=v75;
  }
  v76=v4.cull_enable;
  if(v76!==v5.cull_enable){
  if(v76){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v76;
  }
  v77=v4.cull_face;
  if(v77!==v5.cull_face){
  v1.cullFace(v77);
  v5.cull_face=v77;
  }
  v78=v4.frontFace;
  if(v78!==v5.frontFace){
  v1.frontFace(v78);
  v5.frontFace=v78;
  }
  v79=v4.lineWidth;
  if(v79!==v5.lineWidth){
  v1.lineWidth(v79);
  v5.lineWidth=v79;
  }
  v80=v4.polygonOffset_enable;
  if(v80!==v5.polygonOffset_enable){
  if(v80){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v80;
  }
  v81=v30[0];
  v82=v30[1];
  if(v81!==v31[0]||v82!==v31[1]){
  v1.polygonOffset(v81,v82);
  v31[0]=v81;
  v31[1]=v82;
  }
  v83=v4.sample_alpha;
  if(v83!==v5.sample_alpha){
  if(v83){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v83;
  }
  v84=v4.sample_enable;
  if(v84!==v5.sample_enable){
  if(v84){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v84;
  }
  v85=v32[0];
  v86=v32[1];
  if(v85!==v33[0]||v86!==v33[1]){
  v1.sampleCoverage(v85,v86);
  v33[0]=v85;
  v33[1]=v86;
  }
  v87=v4.stencil_enable;
  if(v87!==v5.stencil_enable){
  if(v87){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v87;
  }
  v88=v4.stencil_mask;
  if(v88!==v5.stencil_mask){
  v1.stencilMask(v88);
  v5.stencil_mask=v88;
  }
  v89=v34[0];
  v90=v34[1];
  v91=v34[2];
  if(v89!==v35[0]||v90!==v35[1]||v91!==v35[2]){
  v1.stencilFunc(v89,v90,v91);
  v35[0]=v89;
  v35[1]=v90;
  v35[2]=v91;
  }
  v92=v36[0];
  v93=v36[1];
  v94=v36[2];
  v95=v36[3];
  if(v92!==v37[0]||v93!==v37[1]||v94!==v37[2]||v95!==v37[3]){
  v1.stencilOpSeparate(v92,v93,v94,v95);
  v37[0]=v92;
  v37[1]=v93;
  v37[2]=v94;
  v37[3]=v95;
  }
  v96=v38[0];
  v97=v38[1];
  v98=v38[2];
  v99=v38[3];
  if(v96!==v39[0]||v97!==v39[1]||v98!==v39[2]||v99!==v39[3]){
  v1.stencilOpSeparate(v96,v97,v98,v99);
  v39[0]=v96;
  v39[1]=v97;
  v39[2]=v98;
  v39[3]=v99;
  }
  v100=v4.scissor_enable;
  if(v100!==v5.scissor_enable){
  if(v100){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v100;
  }
  v101=v40[0];
  v102=v40[1];
  v103=v40[2];
  v104=v40[3];
  if(v101!==v41[0]||v102!==v41[1]||v103!==v41[2]||v104!==v41[3]){
  v1.scissor(v101,v102,v103,v104);
  v41[0]=v101;
  v41[1]=v102;
  v41[2]=v103;
  v41[3]=v104;
  }
  v105=v42[0];
  v106=v42[1];
  v107=v42[2];
  v108=v42[3];
  if(v105!==v43[0]||v106!==v43[1]||v107!==v43[2]||v108!==v43[3]){
  v1.viewport(v105,v106,v107,v108);
  v43[0]=v105;
  v43[1]=v106;
  v43[2]=v107;
  v43[3]=v108;
  }
  v5.dirty=false;
  }
  v109=v5.profile;
  if(v109){
  v110=performance.now();
  g52.count++;
  }
  v111=v9.frag;
  v112=v9.vert;
  v113=v9.program(v112,v111,g19);
  v1.useProgram(v113.program);
  v11.setVAO(null);
  v115=v113.id;
  v116=v114[v115];
  if(v116){
  v116.call(this,a0);
  }
  else{
  v116=v114[v115]=g117(v113);
  v116.call(this,a0);
  }
  v11.setVAO(null);
  if(v109){
  g52.cpuTime+=performance.now()-v110;
  }
  }
  ,"scope":function(a0,a1,a2){
  var v118,v119;
  v118=v5.profile;
  if(v118){
  v119=performance.now();
  g52.count++;
  }
  a1(v2,a0,a2);
  if(v118){
  g52.cpuTime+=performance.now()-v119;
  }
  }
  ,"batch":function(a0,a1){
  var v120,v121,v176,v177,v178,v179,v180,v182,v183;
  v120=v14.angle_instanced_arrays;
  v121=v13.next;
  if(v121!==v13.cur){
  if(v121){
  v1.bindFramebuffer(36160,v121.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v121;
  }
  if(v5.dirty){
  var v122,v123,v124,v125,v126,v127,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,v142,v143,v144,v145,v146,v147,v148,v149,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v165,v166,v167,v168,v169,v170,v171,v172,v173,v174,v175;
  v122=v4.dither;
  if(v122!==v5.dither){
  if(v122){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v122;
  }
  v123=v4.blend_enable;
  if(v123!==v5.blend_enable){
  if(v123){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v123;
  }
  v124=v20[0];
  v125=v20[1];
  v126=v20[2];
  v127=v20[3];
  if(v124!==v21[0]||v125!==v21[1]||v126!==v21[2]||v127!==v21[3]){
  v1.blendColor(v124,v125,v126,v127);
  v21[0]=v124;
  v21[1]=v125;
  v21[2]=v126;
  v21[3]=v127;
  }
  v128=v22[0];
  v129=v22[1];
  if(v128!==v23[0]||v129!==v23[1]){
  v1.blendEquationSeparate(v128,v129);
  v23[0]=v128;
  v23[1]=v129;
  }
  v130=v24[0];
  v131=v24[1];
  v132=v24[2];
  v133=v24[3];
  if(v130!==v25[0]||v131!==v25[1]||v132!==v25[2]||v133!==v25[3]){
  v1.blendFuncSeparate(v130,v131,v132,v133);
  v25[0]=v130;
  v25[1]=v131;
  v25[2]=v132;
  v25[3]=v133;
  }
  v134=v4.depth_enable;
  if(v134!==v5.depth_enable){
  if(v134){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v134;
  }
  v135=v4.depth_func;
  if(v135!==v5.depth_func){
  v1.depthFunc(v135);
  v5.depth_func=v135;
  }
  v136=v26[0];
  v137=v26[1];
  if(v136!==v27[0]||v137!==v27[1]){
  v1.depthRange(v136,v137);
  v27[0]=v136;
  v27[1]=v137;
  }
  v138=v4.depth_mask;
  if(v138!==v5.depth_mask){
  v1.depthMask(v138);
  v5.depth_mask=v138;
  }
  v139=v28[0];
  v140=v28[1];
  v141=v28[2];
  v142=v28[3];
  if(v139!==v29[0]||v140!==v29[1]||v141!==v29[2]||v142!==v29[3]){
  v1.colorMask(v139,v140,v141,v142);
  v29[0]=v139;
  v29[1]=v140;
  v29[2]=v141;
  v29[3]=v142;
  }
  v143=v4.cull_enable;
  if(v143!==v5.cull_enable){
  if(v143){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v143;
  }
  v144=v4.cull_face;
  if(v144!==v5.cull_face){
  v1.cullFace(v144);
  v5.cull_face=v144;
  }
  v145=v4.frontFace;
  if(v145!==v5.frontFace){
  v1.frontFace(v145);
  v5.frontFace=v145;
  }
  v146=v4.lineWidth;
  if(v146!==v5.lineWidth){
  v1.lineWidth(v146);
  v5.lineWidth=v146;
  }
  v147=v4.polygonOffset_enable;
  if(v147!==v5.polygonOffset_enable){
  if(v147){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v147;
  }
  v148=v30[0];
  v149=v30[1];
  if(v148!==v31[0]||v149!==v31[1]){
  v1.polygonOffset(v148,v149);
  v31[0]=v148;
  v31[1]=v149;
  }
  v150=v4.sample_alpha;
  if(v150!==v5.sample_alpha){
  if(v150){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v150;
  }
  v151=v4.sample_enable;
  if(v151!==v5.sample_enable){
  if(v151){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v151;
  }
  v152=v32[0];
  v153=v32[1];
  if(v152!==v33[0]||v153!==v33[1]){
  v1.sampleCoverage(v152,v153);
  v33[0]=v152;
  v33[1]=v153;
  }
  v154=v4.stencil_enable;
  if(v154!==v5.stencil_enable){
  if(v154){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v154;
  }
  v155=v4.stencil_mask;
  if(v155!==v5.stencil_mask){
  v1.stencilMask(v155);
  v5.stencil_mask=v155;
  }
  v156=v34[0];
  v157=v34[1];
  v158=v34[2];
  if(v156!==v35[0]||v157!==v35[1]||v158!==v35[2]){
  v1.stencilFunc(v156,v157,v158);
  v35[0]=v156;
  v35[1]=v157;
  v35[2]=v158;
  }
  v159=v36[0];
  v160=v36[1];
  v161=v36[2];
  v162=v36[3];
  if(v159!==v37[0]||v160!==v37[1]||v161!==v37[2]||v162!==v37[3]){
  v1.stencilOpSeparate(v159,v160,v161,v162);
  v37[0]=v159;
  v37[1]=v160;
  v37[2]=v161;
  v37[3]=v162;
  }
  v163=v38[0];
  v164=v38[1];
  v165=v38[2];
  v166=v38[3];
  if(v163!==v39[0]||v164!==v39[1]||v165!==v39[2]||v166!==v39[3]){
  v1.stencilOpSeparate(v163,v164,v165,v166);
  v39[0]=v163;
  v39[1]=v164;
  v39[2]=v165;
  v39[3]=v166;
  }
  v167=v4.scissor_enable;
  if(v167!==v5.scissor_enable){
  if(v167){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v167;
  }
  v168=v40[0];
  v169=v40[1];
  v170=v40[2];
  v171=v40[3];
  if(v168!==v41[0]||v169!==v41[1]||v170!==v41[2]||v171!==v41[3]){
  v1.scissor(v168,v169,v170,v171);
  v41[0]=v168;
  v41[1]=v169;
  v41[2]=v170;
  v41[3]=v171;
  }
  v172=v42[0];
  v173=v42[1];
  v174=v42[2];
  v175=v42[3];
  if(v172!==v43[0]||v173!==v43[1]||v174!==v43[2]||v175!==v43[3]){
  v1.viewport(v172,v173,v174,v175);
  v43[0]=v172;
  v43[1]=v173;
  v43[2]=v174;
  v43[3]=v175;
  }
  v5.dirty=false;
  }
  v176=v5.profile;
  if(v176){
  v177=performance.now();
  g52.count+=a1;
  }
  v178=v9.frag;
  v179=v9.vert;
  v180=v9.program(v179,v178,g19);
  v1.useProgram(v180.program);
  v11.setVAO(null);
  v182=v180.id;
  v183=v181[v182];
  if(v183){
  v183.call(this,a0,a1);
  }
  else{
  v183=v181[v182]=g184(v180);
  v183.call(this,a0,a1);
  }
  v11.setVAO(null);
  if(v176){
  g52.cpuTime+=performance.now()-v177;
  }
  }
  ,}
  
  },
  "58241.262": function (_gs, g0, g18, g19, g52, g92, g99, g101, g103, g110, g113, g127, g132, g146, g151, g165, g170, g184, g188, g189, g192, g196, g210, g215, g229, g233, g235, g236, g238, g240, g242, g243, g245, g246, g247, g249, g250, g252, g253, g255, g258, g260, g261, g263, g266, g267, g269, g348, g361, g388, g415, g442, g469, g496, g523) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v54,v55,v56,v57,v58;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v53.stride=4;
  v53.offset=0;
  v53.divisor=1;
  v54={
  }
  ;
  v54.stride=4;
  v54.offset=4;
  v54.divisor=1;
  v55={
  }
  ;
  v55.stride=8;
  v55.offset=0;
  v55.divisor=1;
  v56={
  }
  ;
  v56.stride=8;
  v56.offset=8;
  v56.divisor=1;
  v57={
  }
  ;
  v57.stride=8;
  v57.offset=16;
  v57.divisor=1;
  v58={
  }
  ;
  v58.stride=8;
  v58.offset=24;
  v58.divisor=1;
  return {
  "draw":function(a0){
  var v59,v60,v91,v93,v94,v95,v96,v97,v98,v100,v102,v104,v105,v106,v107,v108,v109,v111,v112,v114,v115,v116,v117,v118,v119,v120,v121,v122,v123,v124,v125,v126,v128,v129,v130,v131,v133,v134,v135,v136,v137,v138,v139,v140,v141,v142,v143,v144,v145,v147,v148,v149,v150,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v166,v167,v168,v169,v171,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v183,v185,v186,v187,v190,v191,v193,v194,v195,v197,v198,v199,v200,v201,v202,v203,v204,v205,v206,v207,v208,v209,v211,v212,v213,v214,v216,v217,v218,v219,v220,v221,v222,v223,v224,v225,v226,v227,v228,v230,v231,v232,v234,v237,v239,v241,v244,v248,v251,v254,v256,v257,v259,v262,v264,v265,v268,v270,v271,v272,v273,v274,v275;
  v59=v14.angle_instanced_arrays;
  v60=v13.next;
  if(v60!==v13.cur){
  if(v60){
  v1.bindFramebuffer(36160,v60.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v60;
  }
  if(v5.dirty){
  var v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90;
  v61=v4.dither;
  if(v61!==v5.dither){
  if(v61){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v61;
  }
  v62=v4.depth_func;
  if(v62!==v5.depth_func){
  v1.depthFunc(v62);
  v5.depth_func=v62;
  }
  v63=v26[0];
  v64=v26[1];
  if(v63!==v27[0]||v64!==v27[1]){
  v1.depthRange(v63,v64);
  v27[0]=v63;
  v27[1]=v64;
  }
  v65=v4.depth_mask;
  if(v65!==v5.depth_mask){
  v1.depthMask(v65);
  v5.depth_mask=v65;
  }
  v66=v28[0];
  v67=v28[1];
  v68=v28[2];
  v69=v28[3];
  if(v66!==v29[0]||v67!==v29[1]||v68!==v29[2]||v69!==v29[3]){
  v1.colorMask(v66,v67,v68,v69);
  v29[0]=v66;
  v29[1]=v67;
  v29[2]=v68;
  v29[3]=v69;
  }
  v70=v4.frontFace;
  if(v70!==v5.frontFace){
  v1.frontFace(v70);
  v5.frontFace=v70;
  }
  v71=v4.lineWidth;
  if(v71!==v5.lineWidth){
  v1.lineWidth(v71);
  v5.lineWidth=v71;
  }
  v72=v4.polygonOffset_enable;
  if(v72!==v5.polygonOffset_enable){
  if(v72){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v72;
  }
  v73=v30[0];
  v74=v30[1];
  if(v73!==v31[0]||v74!==v31[1]){
  v1.polygonOffset(v73,v74);
  v31[0]=v73;
  v31[1]=v74;
  }
  v75=v4.sample_alpha;
  if(v75!==v5.sample_alpha){
  if(v75){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v75;
  }
  v76=v4.sample_enable;
  if(v76!==v5.sample_enable){
  if(v76){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v76;
  }
  v77=v32[0];
  v78=v32[1];
  if(v77!==v33[0]||v78!==v33[1]){
  v1.sampleCoverage(v77,v78);
  v33[0]=v77;
  v33[1]=v78;
  }
  v79=v4.stencil_mask;
  if(v79!==v5.stencil_mask){
  v1.stencilMask(v79);
  v5.stencil_mask=v79;
  }
  v80=v34[0];
  v81=v34[1];
  v82=v34[2];
  if(v80!==v35[0]||v81!==v35[1]||v82!==v35[2]){
  v1.stencilFunc(v80,v81,v82);
  v35[0]=v80;
  v35[1]=v81;
  v35[2]=v82;
  }
  v83=v36[0];
  v84=v36[1];
  v85=v36[2];
  v86=v36[3];
  if(v83!==v37[0]||v84!==v37[1]||v85!==v37[2]||v86!==v37[3]){
  v1.stencilOpSeparate(v83,v84,v85,v86);
  v37[0]=v83;
  v37[1]=v84;
  v37[2]=v85;
  v37[3]=v86;
  }
  v87=v38[0];
  v88=v38[1];
  v89=v38[2];
  v90=v38[3];
  if(v87!==v39[0]||v88!==v39[1]||v89!==v39[2]||v90!==v39[3]){
  v1.stencilOpSeparate(v87,v88,v89,v90);
  v39[0]=v87;
  v39[1]=v88;
  v39[2]=v89;
  v39[3]=v90;
  }
  }
  v91=a0["viewport"];
  if(!(v91&&typeof v91==="object"))g18.commandRaise(g92,g19);
  v93=v91.x|0;
  v94=v91.y|0;
  v95="width" in v91?v91.width|0:(v2.framebufferWidth-v93);
  v96="height" in v91?v91.height|0:(v2.framebufferHeight-v94);
  if(!(v95>=0&&v96>=0))g18.commandRaise(g92,g19);
  v97=v2.viewportWidth;
  v2.viewportWidth=v95;
  v98=v2.viewportHeight;
  v2.viewportHeight=v96;
  v1.viewport(v93,v94,v95,v96);
  v43[0]=v93;
  v43[1]=v94;
  v43[2]=v95;
  v43[3]=v96;
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=_gs[3];
  v1.cullFace(_gs[4]);
  v5.cull_face=_gs[5];
  v100=g99.call(this,v2,a0,0);
  if(!(typeof v100==="boolean"))g18.commandRaise(g101,g19);
  if(v100){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v100;
  v102=a0["viewport"];
  if(!(v102&&typeof v102==="object"))g18.commandRaise(g103,g19);
  v104=v102.x|0;
  v105=v102.y|0;
  v106="width" in v102?v102.width|0:(v2.framebufferWidth-v104);
  v107="height" in v102?v102.height|0:(v2.framebufferHeight-v105);
  if(!(v106>=0&&v107>=0))g18.commandRaise(g103,g19);
  v1.scissor(v104,v105,v106,v107);
  v41[0]=v104;
  v41[1]=v105;
  v41[2]=v106;
  v41[3]=v107;
  if(_gs[6]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[7];
  if(_gs[8]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[9];
  v108=v5.profile;
  if(v108){
  v109=performance.now();
  g52.count++;
  }
  v1.useProgram(g110.program);
  v111=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v112=a0["colorBuffer"];
  v53.buffer=v112;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g113,g19);
  v114=false;
  v115=1;
  v116=0;
  v117=0;
  v118=0;
  v119=0;
  v120=null;
  v121=0;
  v122=false;
  v123=5126;
  v124=0;
  v125=0;
  v126=0;
  if(v16(v53)){
  v114=true;
  v120=v8.createStream(34962,v53);
  v123=v120.dtype;
  }
  else{
  v120=v8.getBuffer(v53);
  if(v120){
  v123=v120.dtype;
  }
  else if("constant" in v53){
  v115=2;
  if(typeof v53.constant === "number"){
  v116=v53.constant;
  v117=v118=v119=0;
  }
  else{
  v116=v53.constant.length>0?v53.constant[0]:0;
  v117=v53.constant.length>1?v53.constant[1]:0;
  v118=v53.constant.length>2?v53.constant[2]:0;
  v119=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v120=v8.createStream(34962,v53.buffer);
  }
  else{
  v120=v8.getBuffer(v53.buffer);
  }
  v123="type" in v53?v49[v53.type]:v120.dtype;
  v122=!!v53.normalized;
  v121=v53.size|0;
  v124=v53.offset|0;
  v125=v53.stride|0;
  v126=v53.divisor|0;
  }
  }
  v128=g127.location;
  v129=v10[v128];
  if(v115===1){
  if(!v129.buffer){
  v1.enableVertexAttribArray(v128);
  }
  v130=v121||4;
  if(v129.type!==v123||v129.size!==v130||v129.buffer!==v120||v129.normalized!==v122||v129.offset!==v124||v129.stride!==v125){
  v1.bindBuffer(34962,v120.buffer);
  v1.vertexAttribPointer(v128,v130,v123,v122,v125,v124);
  v129.type=v123;
  v129.size=v130;
  v129.buffer=v120;
  v129.normalized=v122;
  v129.offset=v124;
  v129.stride=v125;
  }
  if(v129.divisor!==v126){
  v111.vertexAttribDivisorANGLE(v128,v126);
  v129.divisor=v126;
  }
  }
  else{
  if(v129.buffer){
  v1.disableVertexAttribArray(v128);
  v129.buffer=null;
  }
  if(v129.x!==v116||v129.y!==v117||v129.z!==v118||v129.w!==v119){
  v1.vertexAttrib4f(v128,v116,v117,v118,v119);
  v129.x=v116;
  v129.y=v117;
  v129.z=v118;
  v129.w=v119;
  }
  }
  v131=a0["positionBuffer"];
  v56.buffer=v131;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g132,g19);
  v133=false;
  v134=1;
  v135=0;
  v136=0;
  v137=0;
  v138=0;
  v139=null;
  v140=0;
  v141=false;
  v142=5126;
  v143=0;
  v144=0;
  v145=0;
  if(v16(v56)){
  v133=true;
  v139=v8.createStream(34962,v56);
  v142=v139.dtype;
  }
  else{
  v139=v8.getBuffer(v56);
  if(v139){
  v142=v139.dtype;
  }
  else if("constant" in v56){
  v134=2;
  if(typeof v56.constant === "number"){
  v135=v56.constant;
  v136=v137=v138=0;
  }
  else{
  v135=v56.constant.length>0?v56.constant[0]:0;
  v136=v56.constant.length>1?v56.constant[1]:0;
  v137=v56.constant.length>2?v56.constant[2]:0;
  v138=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v139=v8.createStream(34962,v56.buffer);
  }
  else{
  v139=v8.getBuffer(v56.buffer);
  }
  v142="type" in v56?v49[v56.type]:v139.dtype;
  v141=!!v56.normalized;
  v140=v56.size|0;
  v143=v56.offset|0;
  v144=v56.stride|0;
  v145=v56.divisor|0;
  }
  }
  v147=g146.location;
  v148=v10[v147];
  if(v134===1){
  if(!v148.buffer){
  v1.enableVertexAttribArray(v147);
  }
  v149=v140||2;
  if(v148.type!==v142||v148.size!==v149||v148.buffer!==v139||v148.normalized!==v141||v148.offset!==v143||v148.stride!==v144){
  v1.bindBuffer(34962,v139.buffer);
  v1.vertexAttribPointer(v147,v149,v142,v141,v144,v143);
  v148.type=v142;
  v148.size=v149;
  v148.buffer=v139;
  v148.normalized=v141;
  v148.offset=v143;
  v148.stride=v144;
  }
  if(v148.divisor!==v145){
  v111.vertexAttribDivisorANGLE(v147,v145);
  v148.divisor=v145;
  }
  }
  else{
  if(v148.buffer){
  v1.disableVertexAttribArray(v147);
  v148.buffer=null;
  }
  if(v148.x!==v135||v148.y!==v136||v148.z!==v137||v148.w!==v138){
  v1.vertexAttrib4f(v147,v135,v136,v137,v138);
  v148.x=v135;
  v148.y=v136;
  v148.z=v137;
  v148.w=v138;
  }
  }
  v150=a0["colorBuffer"];
  v54.buffer=v150;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g151,g19);
  v152=false;
  v153=1;
  v154=0;
  v155=0;
  v156=0;
  v157=0;
  v158=null;
  v159=0;
  v160=false;
  v161=5126;
  v162=0;
  v163=0;
  v164=0;
  if(v16(v54)){
  v152=true;
  v158=v8.createStream(34962,v54);
  v161=v158.dtype;
  }
  else{
  v158=v8.getBuffer(v54);
  if(v158){
  v161=v158.dtype;
  }
  else if("constant" in v54){
  v153=2;
  if(typeof v54.constant === "number"){
  v154=v54.constant;
  v155=v156=v157=0;
  }
  else{
  v154=v54.constant.length>0?v54.constant[0]:0;
  v155=v54.constant.length>1?v54.constant[1]:0;
  v156=v54.constant.length>2?v54.constant[2]:0;
  v157=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v158=v8.createStream(34962,v54.buffer);
  }
  else{
  v158=v8.getBuffer(v54.buffer);
  }
  v161="type" in v54?v49[v54.type]:v158.dtype;
  v160=!!v54.normalized;
  v159=v54.size|0;
  v162=v54.offset|0;
  v163=v54.stride|0;
  v164=v54.divisor|0;
  }
  }
  v166=g165.location;
  v167=v10[v166];
  if(v153===1){
  if(!v167.buffer){
  v1.enableVertexAttribArray(v166);
  }
  v168=v159||4;
  if(v167.type!==v161||v167.size!==v168||v167.buffer!==v158||v167.normalized!==v160||v167.offset!==v162||v167.stride!==v163){
  v1.bindBuffer(34962,v158.buffer);
  v1.vertexAttribPointer(v166,v168,v161,v160,v163,v162);
  v167.type=v161;
  v167.size=v168;
  v167.buffer=v158;
  v167.normalized=v160;
  v167.offset=v162;
  v167.stride=v163;
  }
  if(v167.divisor!==v164){
  v111.vertexAttribDivisorANGLE(v166,v164);
  v167.divisor=v164;
  }
  }
  else{
  if(v167.buffer){
  v1.disableVertexAttribArray(v166);
  v167.buffer=null;
  }
  if(v167.x!==v154||v167.y!==v155||v167.z!==v156||v167.w!==v157){
  v1.vertexAttrib4f(v166,v154,v155,v156,v157);
  v167.x=v154;
  v167.y=v155;
  v167.z=v156;
  v167.w=v157;
  }
  }
  v169=a0["positionBuffer"];
  v57.buffer=v169;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g170,g19);
  v171=false;
  v172=1;
  v173=0;
  v174=0;
  v175=0;
  v176=0;
  v177=null;
  v178=0;
  v179=false;
  v180=5126;
  v181=0;
  v182=0;
  v183=0;
  if(v16(v57)){
  v171=true;
  v177=v8.createStream(34962,v57);
  v180=v177.dtype;
  }
  else{
  v177=v8.getBuffer(v57);
  if(v177){
  v180=v177.dtype;
  }
  else if("constant" in v57){
  v172=2;
  if(typeof v57.constant === "number"){
  v173=v57.constant;
  v174=v175=v176=0;
  }
  else{
  v173=v57.constant.length>0?v57.constant[0]:0;
  v174=v57.constant.length>1?v57.constant[1]:0;
  v175=v57.constant.length>2?v57.constant[2]:0;
  v176=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v177=v8.createStream(34962,v57.buffer);
  }
  else{
  v177=v8.getBuffer(v57.buffer);
  }
  v180="type" in v57?v49[v57.type]:v177.dtype;
  v179=!!v57.normalized;
  v178=v57.size|0;
  v181=v57.offset|0;
  v182=v57.stride|0;
  v183=v57.divisor|0;
  }
  }
  v185=g184.location;
  v186=v10[v185];
  if(v172===1){
  if(!v186.buffer){
  v1.enableVertexAttribArray(v185);
  }
  v187=v178||2;
  if(v186.type!==v180||v186.size!==v187||v186.buffer!==v177||v186.normalized!==v179||v186.offset!==v181||v186.stride!==v182){
  v1.bindBuffer(34962,v177.buffer);
  v1.vertexAttribPointer(v185,v187,v180,v179,v182,v181);
  v186.type=v180;
  v186.size=v187;
  v186.buffer=v177;
  v186.normalized=v179;
  v186.offset=v181;
  v186.stride=v182;
  }
  if(v186.divisor!==v183){
  v111.vertexAttribDivisorANGLE(v185,v183);
  v186.divisor=v183;
  }
  }
  else{
  if(v186.buffer){
  v1.disableVertexAttribArray(v185);
  v186.buffer=null;
  }
  if(v186.x!==v173||v186.y!==v174||v186.z!==v175||v186.w!==v176){
  v1.vertexAttrib4f(v185,v173,v174,v175,v176);
  v186.x=v173;
  v186.y=v174;
  v186.z=v175;
  v186.w=v176;
  }
  }
  v190=g189.location;
  v191=v10[v190];
  if(!v191.buffer){
  v1.enableVertexAttribArray(v190);
  }
  if(v191.type!==5126||v191.size!==1||v191.buffer!==g188||v191.normalized!==false||v191.offset!==0||v191.stride!==8){
  v1.bindBuffer(34962,g188.buffer);
  v1.vertexAttribPointer(v190,1,5126,false,8,0);
  v191.type=5126;
  v191.size=1;
  v191.buffer=g188;
  v191.normalized=false;
  v191.offset=0;
  v191.stride=8;
  }
  if(v191.divisor!==0){
  v111.vertexAttribDivisorANGLE(v190,0);
  v191.divisor=0;
  }
  v193=g192.location;
  v194=v10[v193];
  if(!v194.buffer){
  v1.enableVertexAttribArray(v193);
  }
  if(v194.type!==5126||v194.size!==1||v194.buffer!==g188||v194.normalized!==false||v194.offset!==4||v194.stride!==8){
  v1.bindBuffer(34962,g188.buffer);
  v1.vertexAttribPointer(v193,1,5126,false,8,4);
  v194.type=5126;
  v194.size=1;
  v194.buffer=g188;
  v194.normalized=false;
  v194.offset=4;
  v194.stride=8;
  }
  if(v194.divisor!==0){
  v111.vertexAttribDivisorANGLE(v193,0);
  v194.divisor=0;
  }
  v195=a0["positionBuffer"];
  v58.buffer=v195;
  if(!(v58&&(typeof v58==="object"||typeof v58==="function")&&(v16(v58)||v8.getBuffer(v58)||v8.getBuffer(v58.buffer)||v16(v58.buffer)||("constant" in v58&&(typeof v58.constant==="number"||v17(v58.constant))))))g18.commandRaise(g196,g19);
  v197=false;
  v198=1;
  v199=0;
  v200=0;
  v201=0;
  v202=0;
  v203=null;
  v204=0;
  v205=false;
  v206=5126;
  v207=0;
  v208=0;
  v209=0;
  if(v16(v58)){
  v197=true;
  v203=v8.createStream(34962,v58);
  v206=v203.dtype;
  }
  else{
  v203=v8.getBuffer(v58);
  if(v203){
  v206=v203.dtype;
  }
  else if("constant" in v58){
  v198=2;
  if(typeof v58.constant === "number"){
  v199=v58.constant;
  v200=v201=v202=0;
  }
  else{
  v199=v58.constant.length>0?v58.constant[0]:0;
  v200=v58.constant.length>1?v58.constant[1]:0;
  v201=v58.constant.length>2?v58.constant[2]:0;
  v202=v58.constant.length>3?v58.constant[3]:0;
  }
  }
  else{
  if(v16(v58.buffer)){
  v203=v8.createStream(34962,v58.buffer);
  }
  else{
  v203=v8.getBuffer(v58.buffer);
  }
  v206="type" in v58?v49[v58.type]:v203.dtype;
  v205=!!v58.normalized;
  v204=v58.size|0;
  v207=v58.offset|0;
  v208=v58.stride|0;
  v209=v58.divisor|0;
  }
  }
  v211=g210.location;
  v212=v10[v211];
  if(v198===1){
  if(!v212.buffer){
  v1.enableVertexAttribArray(v211);
  }
  v213=v204||2;
  if(v212.type!==v206||v212.size!==v213||v212.buffer!==v203||v212.normalized!==v205||v212.offset!==v207||v212.stride!==v208){
  v1.bindBuffer(34962,v203.buffer);
  v1.vertexAttribPointer(v211,v213,v206,v205,v208,v207);
  v212.type=v206;
  v212.size=v213;
  v212.buffer=v203;
  v212.normalized=v205;
  v212.offset=v207;
  v212.stride=v208;
  }
  if(v212.divisor!==v209){
  v111.vertexAttribDivisorANGLE(v211,v209);
  v212.divisor=v209;
  }
  }
  else{
  if(v212.buffer){
  v1.disableVertexAttribArray(v211);
  v212.buffer=null;
  }
  if(v212.x!==v199||v212.y!==v200||v212.z!==v201||v212.w!==v202){
  v1.vertexAttrib4f(v211,v199,v200,v201,v202);
  v212.x=v199;
  v212.y=v200;
  v212.z=v201;
  v212.w=v202;
  }
  }
  v214=a0["positionBuffer"];
  v55.buffer=v214;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g215,g19);
  v216=false;
  v217=1;
  v218=0;
  v219=0;
  v220=0;
  v221=0;
  v222=null;
  v223=0;
  v224=false;
  v225=5126;
  v226=0;
  v227=0;
  v228=0;
  if(v16(v55)){
  v216=true;
  v222=v8.createStream(34962,v55);
  v225=v222.dtype;
  }
  else{
  v222=v8.getBuffer(v55);
  if(v222){
  v225=v222.dtype;
  }
  else if("constant" in v55){
  v217=2;
  if(typeof v55.constant === "number"){
  v218=v55.constant;
  v219=v220=v221=0;
  }
  else{
  v218=v55.constant.length>0?v55.constant[0]:0;
  v219=v55.constant.length>1?v55.constant[1]:0;
  v220=v55.constant.length>2?v55.constant[2]:0;
  v221=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v222=v8.createStream(34962,v55.buffer);
  }
  else{
  v222=v8.getBuffer(v55.buffer);
  }
  v225="type" in v55?v49[v55.type]:v222.dtype;
  v224=!!v55.normalized;
  v223=v55.size|0;
  v226=v55.offset|0;
  v227=v55.stride|0;
  v228=v55.divisor|0;
  }
  }
  v230=g229.location;
  v231=v10[v230];
  if(v217===1){
  if(!v231.buffer){
  v1.enableVertexAttribArray(v230);
  }
  v232=v223||2;
  if(v231.type!==v225||v231.size!==v232||v231.buffer!==v222||v231.normalized!==v224||v231.offset!==v226||v231.stride!==v227){
  v1.bindBuffer(34962,v222.buffer);
  v1.vertexAttribPointer(v230,v232,v225,v224,v227,v226);
  v231.type=v225;
  v231.size=v232;
  v231.buffer=v222;
  v231.normalized=v224;
  v231.offset=v226;
  v231.stride=v227;
  }
  if(v231.divisor!==v228){
  v111.vertexAttribDivisorANGLE(v230,v228);
  v231.divisor=v228;
  }
  }
  else{
  if(v231.buffer){
  v1.disableVertexAttribArray(v230);
  v231.buffer=null;
  }
  if(v231.x!==v218||v231.y!==v219||v231.z!==v220||v231.w!==v221){
  v1.vertexAttrib4f(v230,v218,v219,v220,v221);
  v231.x=v218;
  v231.y=v219;
  v231.z=v220;
  v231.w=v221;
  }
  }
  v234=a0["dashLength"];
  if(!(typeof v234==="number"))g18.commandRaise(g235,g19);
  v1.uniform1f(g233.location,v234);
  v237=a0["dashTexture"];
  if(v237&&v237._reglType==="framebuffer"){
  v237=v237.color[0];
  }
  if(!(typeof v237==="function"&&v237._reglType==="texture2d"))g18.commandRaise(g238,g19);
  v239=v237._texture;
  v1.uniform1i(g236.location,v239.bind());
  v241=a0["depth"];
  if(!(typeof v241==="number"))g18.commandRaise(g242,g19);
  v1.uniform1f(g240.location,v241);
  v244=a0["miterLimit"];
  if(!(typeof v244==="number"))g18.commandRaise(g245,g19);
  v1.uniform1f(g243.location,v244);
  v248=g247.call(this,v2,a0,0);
  if(!(typeof v248==="number"))g18.commandRaise(g249,g19);
  v1.uniform1f(g246.location,v248);
  v251=a0["opacity"];
  if(!(typeof v251==="number"))g18.commandRaise(g252,g19);
  v1.uniform1f(g250.location,v251);
  v254=a0["scale"];
  if(!(v17(v254)&&v254.length===2))g18.commandRaise(g255,g19);
  v256=v254[0];
  v257=v254[1];
  v1.uniform2f(g253.location,v256,v257);
  v259=a0["thickness"];
  if(!(typeof v259==="number"))g18.commandRaise(g260,g19);
  v1.uniform1f(g258.location,v259);
  v262=a0["translate"];
  if(!(v17(v262)&&v262.length===2))g18.commandRaise(g263,g19);
  v264=v262[0];
  v265=v262[1];
  v1.uniform2f(g261.location,v264,v265);
  v268=g267.call(this,v2,a0,0);
  if(!(v17(v268)&&v268.length===4))g18.commandRaise(g269,g19);
  v270=v268[0];
  v271=v268[1];
  v272=v268[2];
  v273=v268[3];
  v1.uniform4f(g266.location,v270,v271,v272,v273);
  v274=v6.elements;
  if(v274){
  v1.bindBuffer(34963,v274.buffer.buffer);
  }
  else if(v11.currentVAO){
  v274=v7.getElements(v11.currentVAO.elements);
  if(v274)v1.bindBuffer(34963,v274.buffer.buffer);
  }
  v275=a0["count"];
  if(v275>0){
  if(v274){
  v111.drawElementsInstancedANGLE(5,4,v274.type,0<<((v274.type-5121)>>1),v275);
  }
  else{
  v111.drawArraysInstancedANGLE(5,0,4,v275);
  }
  }
  else if(v275<0){
  if(v274){
  v1.drawElements(5,4,v274.type,0<<((v274.type-5121)>>1));
  }
  else{
  v1.drawArrays(5,0,4);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v97;
  v2.viewportHeight=v98;
  if(v108){
  g52.cpuTime+=performance.now()-v109;
  }
  if(v114){
  v8.destroyStream(v120);
  }
  if(v133){
  v8.destroyStream(v139);
  }
  if(v152){
  v8.destroyStream(v158);
  }
  if(v171){
  v8.destroyStream(v177);
  }
  if(v197){
  v8.destroyStream(v203);
  }
  if(v216){
  v8.destroyStream(v222);
  }
  v239.unbind();
  }
  ,"scope":function(a0,a1,a2){
  var v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v290,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v301,v302,v303,v304,v305,v306,v307,v308,v309,v310,v311,v312,v313,v314,v315,v316,v317,v318,v319,v320,v321,v322,v323,v324,v325,v326,v327,v328,v329,v330,v331,v332,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v375,v376,v377,v378,v379,v380,v381,v382,v383,v384,v385,v386,v387,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v403,v404,v405,v406,v407,v408,v409,v410,v411,v412,v413,v414,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v434,v435,v436,v437,v438,v439,v440,v441,v443,v444,v445,v446,v447,v448,v449,v450,v451,v452,v453,v454,v455,v456,v457,v458,v459,v460,v461,v462,v463,v464,v465,v466,v467,v468,v470,v471,v472,v473,v474,v475,v476,v477,v478,v479,v480,v481,v482,v483,v484,v485,v486,v487,v488,v489,v490,v491,v492,v493,v494,v495,v497,v498,v499,v500,v501,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v514,v515,v516,v517,v518,v519,v520,v521,v522,v524,v525,v526,v527,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537;
  v276=a0["viewport"];
  if(!(v276&&typeof v276==="object"))g18.commandRaise(g92,g19);
  v277=v276.x|0;
  v278=v276.y|0;
  v279="width" in v276?v276.width|0:(v2.framebufferWidth-v277);
  v280="height" in v276?v276.height|0:(v2.framebufferHeight-v278);
  if(!(v279>=0&&v280>=0))g18.commandRaise(g92,g19);
  v281=v2.viewportWidth;
  v2.viewportWidth=v279;
  v282=v2.viewportHeight;
  v2.viewportHeight=v280;
  v283=v42[0];
  v42[0]=_gs[10];
  v284=v42[1];
  v42[1]=_gs[11];
  v285=v42[2];
  v42[2]=_gs[12];
  v286=v42[3];
  v42[3]=_gs[13];
  v287=v20[0];
  v20[0]=_gs[14];
  v288=v20[1];
  v20[1]=_gs[15];
  v289=v20[2];
  v20[2]=_gs[16];
  v290=v20[3];
  v20[3]=_gs[17];
  v291=v4.blend_enable;
  v4.blend_enable=_gs[18];
  v292=v22[0];
  v22[0]=_gs[19];
  v293=v22[1];
  v22[1]=_gs[20];
  v294=v24[0];
  v24[0]=_gs[21];
  v295=v24[1];
  v24[1]=_gs[22];
  v296=v24[2];
  v24[2]=_gs[23];
  v297=v24[3];
  v24[3]=_gs[24];
  v298=v4.cull_enable;
  v4.cull_enable=_gs[25];
  v299=v4.cull_face;
  v4.cull_face=_gs[26];
  v300=g99.call(this,v2,a0,a2);
  if(!(typeof v300==="boolean"))g18.commandRaise(g101,g19);
  v301=v4.depth_enable;
  v4.depth_enable=_gs[27];
  v302=a0["viewport"];
  if(!(v302&&typeof v302==="object"))g18.commandRaise(g103,g19);
  v303=v302.x|0;
  v304=v302.y|0;
  v305="width" in v302?v302.width|0:(v2.framebufferWidth-v303);
  v306="height" in v302?v302.height|0:(v2.framebufferHeight-v304);
  if(!(v305>=0&&v306>=0))g18.commandRaise(g103,g19);
  v307=v40[0];
  v40[0]=_gs[28];
  v308=v40[1];
  v40[1]=_gs[29];
  v309=v40[2];
  v40[2]=_gs[30];
  v310=v40[3];
  v40[3]=_gs[31];
  v311=v4.scissor_enable;
  v4.scissor_enable=_gs[32];
  v312=v4.stencil_enable;
  v4.stencil_enable=_gs[33];
  v313=v5.profile;
  if(v313){
  v314=performance.now();
  g52.count++;
  }
  v315=v6.offset;
  v6.offset=_gs[34];
  v316=v6.count;
  v6.count=_gs[35];
  v317=a0["count"];
  v318=v6.instances;
  v6.instances=_gs[36];
  v319=v6.primitive;
  v6.primitive=_gs[37];
  v320=g247.call(this,v2,a0,a2);
  v321=v12[_gs[38]];
  v12[_gs[38]]=v320;
  v322=a0["miterLimit"];
  v323=v12[_gs[39]];
  v12[_gs[39]]=v322;
  v324=a0["scale"];
  v325=v12[_gs[40]];
  v12[_gs[40]]=v324;
  v326=a0["scaleFract"];
  v327=v12[_gs[41]];
  v12[_gs[41]]=v326;
  v328=a0["translateFract"];
  v329=v12[_gs[42]];
  v12[_gs[42]]=v328;
  v330=a0["translate"];
  v331=v12[_gs[43]];
  v12[_gs[43]]=v330;
  v332=a0["thickness"];
  v333=v12[_gs[44]];
  v12[_gs[44]]=v332;
  v334=a0["dashTexture"];
  v335=v12[_gs[45]];
  v12[_gs[45]]=v334;
  v336=a0["opacity"];
  v337=v12[_gs[46]];
  v12[_gs[46]]=v336;
  v338=v2["pixelRatio"];
  v339=v12[_gs[47]];
  v12[_gs[47]]=v338;
  v340=a0["id"];
  v341=v12[_gs[48]];
  v12[_gs[48]]=v340;
  v342=a0["dashLength"];
  v343=v12[_gs[49]];
  v12[_gs[49]]=v342;
  v344=g267.call(this,v2,a0,a2);
  v345=v12[_gs[50]];
  v12[_gs[50]]=v344;
  v346=a0["depth"];
  v347=v12[_gs[51]];
  v12[_gs[51]]=v346;
  v349=g348.state;
  g348.state=1;
  v350=g348.x;
  g348.x=0;
  v351=g348.y;
  g348.y=0;
  v352=g348.z;
  g348.z=0;
  v353=g348.w;
  g348.w=0;
  v354=g348.buffer;
  g348.buffer=g188;
  v355=g348.size;
  g348.size=0;
  v356=g348.normalized;
  g348.normalized=false;
  v357=g348.type;
  g348.type=5126;
  v358=g348.offset;
  g348.offset=0;
  v359=g348.stride;
  g348.stride=8;
  v360=g348.divisor;
  g348.divisor=0;
  v362=g361.state;
  g361.state=1;
  v363=g361.x;
  g361.x=0;
  v364=g361.y;
  g361.y=0;
  v365=g361.z;
  g361.z=0;
  v366=g361.w;
  g361.w=0;
  v367=g361.buffer;
  g361.buffer=g188;
  v368=g361.size;
  g361.size=0;
  v369=g361.normalized;
  g361.normalized=false;
  v370=g361.type;
  g361.type=5126;
  v371=g361.offset;
  g361.offset=4;
  v372=g361.stride;
  g361.stride=8;
  v373=g361.divisor;
  g361.divisor=0;
  v374=a0["colorBuffer"];
  v53.buffer=v374;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g113,g19);
  v375=false;
  v376=1;
  v377=0;
  v378=0;
  v379=0;
  v380=0;
  v381=null;
  v382=0;
  v383=false;
  v384=5126;
  v385=0;
  v386=0;
  v387=0;
  if(v16(v53)){
  v375=true;
  v381=v8.createStream(34962,v53);
  v384=v381.dtype;
  }
  else{
  v381=v8.getBuffer(v53);
  if(v381){
  v384=v381.dtype;
  }
  else if("constant" in v53){
  v376=2;
  if(typeof v53.constant === "number"){
  v377=v53.constant;
  v378=v379=v380=0;
  }
  else{
  v377=v53.constant.length>0?v53.constant[0]:0;
  v378=v53.constant.length>1?v53.constant[1]:0;
  v379=v53.constant.length>2?v53.constant[2]:0;
  v380=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v381=v8.createStream(34962,v53.buffer);
  }
  else{
  v381=v8.getBuffer(v53.buffer);
  }
  v384="type" in v53?v49[v53.type]:v381.dtype;
  v383=!!v53.normalized;
  v382=v53.size|0;
  v385=v53.offset|0;
  v386=v53.stride|0;
  v387=v53.divisor|0;
  }
  }
  v389=g388.state;
  g388.state=v376;
  v390=g388.x;
  g388.x=v377;
  v391=g388.y;
  g388.y=v378;
  v392=g388.z;
  g388.z=v379;
  v393=g388.w;
  g388.w=v380;
  v394=g388.buffer;
  g388.buffer=v381;
  v395=g388.size;
  g388.size=v382;
  v396=g388.normalized;
  g388.normalized=v383;
  v397=g388.type;
  g388.type=v384;
  v398=g388.offset;
  g388.offset=v385;
  v399=g388.stride;
  g388.stride=v386;
  v400=g388.divisor;
  g388.divisor=v387;
  v401=a0["colorBuffer"];
  v54.buffer=v401;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g151,g19);
  v402=false;
  v403=1;
  v404=0;
  v405=0;
  v406=0;
  v407=0;
  v408=null;
  v409=0;
  v410=false;
  v411=5126;
  v412=0;
  v413=0;
  v414=0;
  if(v16(v54)){
  v402=true;
  v408=v8.createStream(34962,v54);
  v411=v408.dtype;
  }
  else{
  v408=v8.getBuffer(v54);
  if(v408){
  v411=v408.dtype;
  }
  else if("constant" in v54){
  v403=2;
  if(typeof v54.constant === "number"){
  v404=v54.constant;
  v405=v406=v407=0;
  }
  else{
  v404=v54.constant.length>0?v54.constant[0]:0;
  v405=v54.constant.length>1?v54.constant[1]:0;
  v406=v54.constant.length>2?v54.constant[2]:0;
  v407=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v408=v8.createStream(34962,v54.buffer);
  }
  else{
  v408=v8.getBuffer(v54.buffer);
  }
  v411="type" in v54?v49[v54.type]:v408.dtype;
  v410=!!v54.normalized;
  v409=v54.size|0;
  v412=v54.offset|0;
  v413=v54.stride|0;
  v414=v54.divisor|0;
  }
  }
  v416=g415.state;
  g415.state=v403;
  v417=g415.x;
  g415.x=v404;
  v418=g415.y;
  g415.y=v405;
  v419=g415.z;
  g415.z=v406;
  v420=g415.w;
  g415.w=v407;
  v421=g415.buffer;
  g415.buffer=v408;
  v422=g415.size;
  g415.size=v409;
  v423=g415.normalized;
  g415.normalized=v410;
  v424=g415.type;
  g415.type=v411;
  v425=g415.offset;
  g415.offset=v412;
  v426=g415.stride;
  g415.stride=v413;
  v427=g415.divisor;
  g415.divisor=v414;
  v428=a0["positionBuffer"];
  v55.buffer=v428;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g215,g19);
  v429=false;
  v430=1;
  v431=0;
  v432=0;
  v433=0;
  v434=0;
  v435=null;
  v436=0;
  v437=false;
  v438=5126;
  v439=0;
  v440=0;
  v441=0;
  if(v16(v55)){
  v429=true;
  v435=v8.createStream(34962,v55);
  v438=v435.dtype;
  }
  else{
  v435=v8.getBuffer(v55);
  if(v435){
  v438=v435.dtype;
  }
  else if("constant" in v55){
  v430=2;
  if(typeof v55.constant === "number"){
  v431=v55.constant;
  v432=v433=v434=0;
  }
  else{
  v431=v55.constant.length>0?v55.constant[0]:0;
  v432=v55.constant.length>1?v55.constant[1]:0;
  v433=v55.constant.length>2?v55.constant[2]:0;
  v434=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v435=v8.createStream(34962,v55.buffer);
  }
  else{
  v435=v8.getBuffer(v55.buffer);
  }
  v438="type" in v55?v49[v55.type]:v435.dtype;
  v437=!!v55.normalized;
  v436=v55.size|0;
  v439=v55.offset|0;
  v440=v55.stride|0;
  v441=v55.divisor|0;
  }
  }
  v443=g442.state;
  g442.state=v430;
  v444=g442.x;
  g442.x=v431;
  v445=g442.y;
  g442.y=v432;
  v446=g442.z;
  g442.z=v433;
  v447=g442.w;
  g442.w=v434;
  v448=g442.buffer;
  g442.buffer=v435;
  v449=g442.size;
  g442.size=v436;
  v450=g442.normalized;
  g442.normalized=v437;
  v451=g442.type;
  g442.type=v438;
  v452=g442.offset;
  g442.offset=v439;
  v453=g442.stride;
  g442.stride=v440;
  v454=g442.divisor;
  g442.divisor=v441;
  v455=a0["positionBuffer"];
  v56.buffer=v455;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g132,g19);
  v456=false;
  v457=1;
  v458=0;
  v459=0;
  v460=0;
  v461=0;
  v462=null;
  v463=0;
  v464=false;
  v465=5126;
  v466=0;
  v467=0;
  v468=0;
  if(v16(v56)){
  v456=true;
  v462=v8.createStream(34962,v56);
  v465=v462.dtype;
  }
  else{
  v462=v8.getBuffer(v56);
  if(v462){
  v465=v462.dtype;
  }
  else if("constant" in v56){
  v457=2;
  if(typeof v56.constant === "number"){
  v458=v56.constant;
  v459=v460=v461=0;
  }
  else{
  v458=v56.constant.length>0?v56.constant[0]:0;
  v459=v56.constant.length>1?v56.constant[1]:0;
  v460=v56.constant.length>2?v56.constant[2]:0;
  v461=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v462=v8.createStream(34962,v56.buffer);
  }
  else{
  v462=v8.getBuffer(v56.buffer);
  }
  v465="type" in v56?v49[v56.type]:v462.dtype;
  v464=!!v56.normalized;
  v463=v56.size|0;
  v466=v56.offset|0;
  v467=v56.stride|0;
  v468=v56.divisor|0;
  }
  }
  v470=g469.state;
  g469.state=v457;
  v471=g469.x;
  g469.x=v458;
  v472=g469.y;
  g469.y=v459;
  v473=g469.z;
  g469.z=v460;
  v474=g469.w;
  g469.w=v461;
  v475=g469.buffer;
  g469.buffer=v462;
  v476=g469.size;
  g469.size=v463;
  v477=g469.normalized;
  g469.normalized=v464;
  v478=g469.type;
  g469.type=v465;
  v479=g469.offset;
  g469.offset=v466;
  v480=g469.stride;
  g469.stride=v467;
  v481=g469.divisor;
  g469.divisor=v468;
  v482=a0["positionBuffer"];
  v57.buffer=v482;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g170,g19);
  v483=false;
  v484=1;
  v485=0;
  v486=0;
  v487=0;
  v488=0;
  v489=null;
  v490=0;
  v491=false;
  v492=5126;
  v493=0;
  v494=0;
  v495=0;
  if(v16(v57)){
  v483=true;
  v489=v8.createStream(34962,v57);
  v492=v489.dtype;
  }
  else{
  v489=v8.getBuffer(v57);
  if(v489){
  v492=v489.dtype;
  }
  else if("constant" in v57){
  v484=2;
  if(typeof v57.constant === "number"){
  v485=v57.constant;
  v486=v487=v488=0;
  }
  else{
  v485=v57.constant.length>0?v57.constant[0]:0;
  v486=v57.constant.length>1?v57.constant[1]:0;
  v487=v57.constant.length>2?v57.constant[2]:0;
  v488=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v489=v8.createStream(34962,v57.buffer);
  }
  else{
  v489=v8.getBuffer(v57.buffer);
  }
  v492="type" in v57?v49[v57.type]:v489.dtype;
  v491=!!v57.normalized;
  v490=v57.size|0;
  v493=v57.offset|0;
  v494=v57.stride|0;
  v495=v57.divisor|0;
  }
  }
  v497=g496.state;
  g496.state=v484;
  v498=g496.x;
  g496.x=v485;
  v499=g496.y;
  g496.y=v486;
  v500=g496.z;
  g496.z=v487;
  v501=g496.w;
  g496.w=v488;
  v502=g496.buffer;
  g496.buffer=v489;
  v503=g496.size;
  g496.size=v490;
  v504=g496.normalized;
  g496.normalized=v491;
  v505=g496.type;
  g496.type=v492;
  v506=g496.offset;
  g496.offset=v493;
  v507=g496.stride;
  g496.stride=v494;
  v508=g496.divisor;
  g496.divisor=v495;
  v509=a0["positionBuffer"];
  v58.buffer=v509;
  if(!(v58&&(typeof v58==="object"||typeof v58==="function")&&(v16(v58)||v8.getBuffer(v58)||v8.getBuffer(v58.buffer)||v16(v58.buffer)||("constant" in v58&&(typeof v58.constant==="number"||v17(v58.constant))))))g18.commandRaise(g196,g19);
  v510=false;
  v511=1;
  v512=0;
  v513=0;
  v514=0;
  v515=0;
  v516=null;
  v517=0;
  v518=false;
  v519=5126;
  v520=0;
  v521=0;
  v522=0;
  if(v16(v58)){
  v510=true;
  v516=v8.createStream(34962,v58);
  v519=v516.dtype;
  }
  else{
  v516=v8.getBuffer(v58);
  if(v516){
  v519=v516.dtype;
  }
  else if("constant" in v58){
  v511=2;
  if(typeof v58.constant === "number"){
  v512=v58.constant;
  v513=v514=v515=0;
  }
  else{
  v512=v58.constant.length>0?v58.constant[0]:0;
  v513=v58.constant.length>1?v58.constant[1]:0;
  v514=v58.constant.length>2?v58.constant[2]:0;
  v515=v58.constant.length>3?v58.constant[3]:0;
  }
  }
  else{
  if(v16(v58.buffer)){
  v516=v8.createStream(34962,v58.buffer);
  }
  else{
  v516=v8.getBuffer(v58.buffer);
  }
  v519="type" in v58?v49[v58.type]:v516.dtype;
  v518=!!v58.normalized;
  v517=v58.size|0;
  v520=v58.offset|0;
  v521=v58.stride|0;
  v522=v58.divisor|0;
  }
  }
  v524=g523.state;
  g523.state=v511;
  v525=g523.x;
  g523.x=v512;
  v526=g523.y;
  g523.y=v513;
  v527=g523.z;
  g523.z=v514;
  v528=g523.w;
  g523.w=v515;
  v529=g523.buffer;
  g523.buffer=v516;
  v530=g523.size;
  g523.size=v517;
  v531=g523.normalized;
  g523.normalized=v518;
  v532=g523.type;
  g523.type=v519;
  v533=g523.offset;
  g523.offset=v520;
  v534=g523.stride;
  g523.stride=v521;
  v535=g523.divisor;
  g523.divisor=v522;
  v536=v9.vert;
  v9.vert=_gs[52];
  v537=v9.frag;
  v9.frag=_gs[53];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v281;
  v2.viewportHeight=v282;
  v42[0]=v283;
  v42[1]=v284;
  v42[2]=v285;
  v42[3]=v286;
  v20[0]=v287;
  v20[1]=v288;
  v20[2]=v289;
  v20[3]=v290;
  v4.blend_enable=v291;
  v22[0]=v292;
  v22[1]=v293;
  v24[0]=v294;
  v24[1]=v295;
  v24[2]=v296;
  v24[3]=v297;
  v4.cull_enable=v298;
  v4.cull_face=v299;
  v4.depth_enable=v301;
  v40[0]=v307;
  v40[1]=v308;
  v40[2]=v309;
  v40[3]=v310;
  v4.scissor_enable=v311;
  v4.stencil_enable=v312;
  if(v313){
  g52.cpuTime+=performance.now()-v314;
  }
  v6.offset=v315;
  v6.count=v316;
  v6.instances=v318;
  v6.primitive=v319;
  v12[_gs[38]]=v321;
  v12[_gs[39]]=v323;
  v12[_gs[40]]=v325;
  v12[_gs[41]]=v327;
  v12[_gs[42]]=v329;
  v12[_gs[43]]=v331;
  v12[_gs[44]]=v333;
  v12[_gs[45]]=v335;
  v12[_gs[46]]=v337;
  v12[_gs[47]]=v339;
  v12[_gs[48]]=v341;
  v12[_gs[49]]=v343;
  v12[_gs[50]]=v345;
  v12[_gs[51]]=v347;
  g348.state=v349;
  g348.x=v350;
  g348.y=v351;
  g348.z=v352;
  g348.w=v353;
  g348.buffer=v354;
  g348.size=v355;
  g348.normalized=v356;
  g348.type=v357;
  g348.offset=v358;
  g348.stride=v359;
  g348.divisor=v360;
  g361.state=v362;
  g361.x=v363;
  g361.y=v364;
  g361.z=v365;
  g361.w=v366;
  g361.buffer=v367;
  g361.size=v368;
  g361.normalized=v369;
  g361.type=v370;
  g361.offset=v371;
  g361.stride=v372;
  g361.divisor=v373;
  if(v375){
  v8.destroyStream(v381);
  }
  g388.state=v389;
  g388.x=v390;
  g388.y=v391;
  g388.z=v392;
  g388.w=v393;
  g388.buffer=v394;
  g388.size=v395;
  g388.normalized=v396;
  g388.type=v397;
  g388.offset=v398;
  g388.stride=v399;
  g388.divisor=v400;
  if(v402){
  v8.destroyStream(v408);
  }
  g415.state=v416;
  g415.x=v417;
  g415.y=v418;
  g415.z=v419;
  g415.w=v420;
  g415.buffer=v421;
  g415.size=v422;
  g415.normalized=v423;
  g415.type=v424;
  g415.offset=v425;
  g415.stride=v426;
  g415.divisor=v427;
  if(v429){
  v8.destroyStream(v435);
  }
  g442.state=v443;
  g442.x=v444;
  g442.y=v445;
  g442.z=v446;
  g442.w=v447;
  g442.buffer=v448;
  g442.size=v449;
  g442.normalized=v450;
  g442.type=v451;
  g442.offset=v452;
  g442.stride=v453;
  g442.divisor=v454;
  if(v456){
  v8.destroyStream(v462);
  }
  g469.state=v470;
  g469.x=v471;
  g469.y=v472;
  g469.z=v473;
  g469.w=v474;
  g469.buffer=v475;
  g469.size=v476;
  g469.normalized=v477;
  g469.type=v478;
  g469.offset=v479;
  g469.stride=v480;
  g469.divisor=v481;
  if(v483){
  v8.destroyStream(v489);
  }
  g496.state=v497;
  g496.x=v498;
  g496.y=v499;
  g496.z=v500;
  g496.w=v501;
  g496.buffer=v502;
  g496.size=v503;
  g496.normalized=v504;
  g496.type=v505;
  g496.offset=v506;
  g496.stride=v507;
  g496.divisor=v508;
  if(v510){
  v8.destroyStream(v516);
  }
  g523.state=v524;
  g523.x=v525;
  g523.y=v526;
  g523.z=v527;
  g523.w=v528;
  g523.buffer=v529;
  g523.size=v530;
  g523.normalized=v531;
  g523.type=v532;
  g523.offset=v533;
  g523.stride=v534;
  g523.divisor=v535;
  v9.vert=v536;
  v9.frag=v537;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v538,v539,v570,v571,v572,v573,v574;
  v538=v14.angle_instanced_arrays;
  v539=v13.next;
  if(v539!==v13.cur){
  if(v539){
  v1.bindFramebuffer(36160,v539.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v539;
  }
  if(v5.dirty){
  var v540,v541,v542,v543,v544,v545,v546,v547,v548,v549,v550,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v569;
  v540=v4.dither;
  if(v540!==v5.dither){
  if(v540){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v540;
  }
  v541=v4.depth_func;
  if(v541!==v5.depth_func){
  v1.depthFunc(v541);
  v5.depth_func=v541;
  }
  v542=v26[0];
  v543=v26[1];
  if(v542!==v27[0]||v543!==v27[1]){
  v1.depthRange(v542,v543);
  v27[0]=v542;
  v27[1]=v543;
  }
  v544=v4.depth_mask;
  if(v544!==v5.depth_mask){
  v1.depthMask(v544);
  v5.depth_mask=v544;
  }
  v545=v28[0];
  v546=v28[1];
  v547=v28[2];
  v548=v28[3];
  if(v545!==v29[0]||v546!==v29[1]||v547!==v29[2]||v548!==v29[3]){
  v1.colorMask(v545,v546,v547,v548);
  v29[0]=v545;
  v29[1]=v546;
  v29[2]=v547;
  v29[3]=v548;
  }
  v549=v4.frontFace;
  if(v549!==v5.frontFace){
  v1.frontFace(v549);
  v5.frontFace=v549;
  }
  v550=v4.lineWidth;
  if(v550!==v5.lineWidth){
  v1.lineWidth(v550);
  v5.lineWidth=v550;
  }
  v551=v4.polygonOffset_enable;
  if(v551!==v5.polygonOffset_enable){
  if(v551){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v551;
  }
  v552=v30[0];
  v553=v30[1];
  if(v552!==v31[0]||v553!==v31[1]){
  v1.polygonOffset(v552,v553);
  v31[0]=v552;
  v31[1]=v553;
  }
  v554=v4.sample_alpha;
  if(v554!==v5.sample_alpha){
  if(v554){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v554;
  }
  v555=v4.sample_enable;
  if(v555!==v5.sample_enable){
  if(v555){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v555;
  }
  v556=v32[0];
  v557=v32[1];
  if(v556!==v33[0]||v557!==v33[1]){
  v1.sampleCoverage(v556,v557);
  v33[0]=v556;
  v33[1]=v557;
  }
  v558=v4.stencil_mask;
  if(v558!==v5.stencil_mask){
  v1.stencilMask(v558);
  v5.stencil_mask=v558;
  }
  v559=v34[0];
  v560=v34[1];
  v561=v34[2];
  if(v559!==v35[0]||v560!==v35[1]||v561!==v35[2]){
  v1.stencilFunc(v559,v560,v561);
  v35[0]=v559;
  v35[1]=v560;
  v35[2]=v561;
  }
  v562=v36[0];
  v563=v36[1];
  v564=v36[2];
  v565=v36[3];
  if(v562!==v37[0]||v563!==v37[1]||v564!==v37[2]||v565!==v37[3]){
  v1.stencilOpSeparate(v562,v563,v564,v565);
  v37[0]=v562;
  v37[1]=v563;
  v37[2]=v564;
  v37[3]=v565;
  }
  v566=v38[0];
  v567=v38[1];
  v568=v38[2];
  v569=v38[3];
  if(v566!==v39[0]||v567!==v39[1]||v568!==v39[2]||v569!==v39[3]){
  v1.stencilOpSeparate(v566,v567,v568,v569);
  v39[0]=v566;
  v39[1]=v567;
  v39[2]=v568;
  v39[3]=v569;
  }
  }
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[54]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[55];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[56]){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=_gs[57];
  v1.cullFace(_gs[58]);
  v5.cull_face=_gs[59];
  if(_gs[60]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[61];
  if(_gs[62]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[63];
  v570=v5.profile;
  if(v570){
  v571=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g110.program);
  v572=v14.angle_instanced_arrays;
  var v588,v589,v590,v591,v727;
  v11.setVAO(null);
  v588=g189.location;
  v589=v10[v588];
  if(!v589.buffer){
  v1.enableVertexAttribArray(v588);
  }
  if(v589.type!==5126||v589.size!==1||v589.buffer!==g188||v589.normalized!==false||v589.offset!==0||v589.stride!==8){
  v1.bindBuffer(34962,g188.buffer);
  v1.vertexAttribPointer(v588,1,5126,false,8,0);
  v589.type=5126;
  v589.size=1;
  v589.buffer=g188;
  v589.normalized=false;
  v589.offset=0;
  v589.stride=8;
  }
  if(v589.divisor!==0){
  v572.vertexAttribDivisorANGLE(v588,0);
  v589.divisor=0;
  }
  v590=g192.location;
  v591=v10[v590];
  if(!v591.buffer){
  v1.enableVertexAttribArray(v590);
  }
  if(v591.type!==5126||v591.size!==1||v591.buffer!==g188||v591.normalized!==false||v591.offset!==4||v591.stride!==8){
  v1.bindBuffer(34962,g188.buffer);
  v1.vertexAttribPointer(v590,1,5126,false,8,4);
  v591.type=5126;
  v591.size=1;
  v591.buffer=g188;
  v591.normalized=false;
  v591.offset=4;
  v591.stride=8;
  }
  if(v591.divisor!==0){
  v572.vertexAttribDivisorANGLE(v590,0);
  v591.divisor=0;
  }
  v727=v6.elements;
  if(v727){
  v1.bindBuffer(34963,v727.buffer.buffer);
  }
  else if(v11.currentVAO){
  v727=v7.getElements(v11.currentVAO.elements);
  if(v727)v1.bindBuffer(34963,v727.buffer.buffer);
  }
  for(v573=0;
  v573<a1;
  ++v573){
  v574=a0[v573];
  var v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v586,v587,v592,v593,v594,v595,v596,v597,v598,v599,v600,v601,v602,v603,v604,v605,v606,v607,v608,v609,v610,v611,v612,v613,v614,v615,v616,v617,v618,v619,v620,v621,v622,v623,v624,v625,v626,v627,v628,v629,v630,v631,v632,v633,v634,v635,v636,v637,v638,v639,v640,v641,v642,v643,v644,v645,v646,v647,v648,v649,v650,v651,v652,v653,v654,v655,v656,v657,v658,v659,v660,v661,v662,v663,v664,v665,v666,v667,v668,v669,v670,v671,v672,v673,v674,v675,v676,v677,v678,v679,v680,v681,v682,v683,v684,v685,v686,v687,v688,v689,v690,v691,v692,v693,v694,v695,v696,v697,v698,v699,v700,v701,v702,v703,v704,v705,v706,v707,v708,v709,v710,v711,v712,v713,v714,v715,v716,v717,v718,v719,v720,v721,v722,v723,v724,v725,v726,v728;
  v575=v574["viewport"];
  if(!(v575&&typeof v575==="object"))g18.commandRaise(g92,g19);
  v576=v575.x|0;
  v577=v575.y|0;
  v578="width" in v575?v575.width|0:(v2.framebufferWidth-v576);
  v579="height" in v575?v575.height|0:(v2.framebufferHeight-v577);
  if(!(v578>=0&&v579>=0))g18.commandRaise(g92,g19);
  v580=v2.viewportWidth;
  v2.viewportWidth=v578;
  v581=v2.viewportHeight;
  v2.viewportHeight=v579;
  v1.viewport(v576,v577,v578,v579);
  v43[0]=v576;
  v43[1]=v577;
  v43[2]=v578;
  v43[3]=v579;
  v582=g99.call(this,v2,v574,v573);
  if(!(typeof v582==="boolean"))g18.commandRaise(g101,g19);
  if(v582){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v582;
  v583=v574["viewport"];
  if(!(v583&&typeof v583==="object"))g18.commandRaise(g103,g19);
  v584=v583.x|0;
  v585=v583.y|0;
  v586="width" in v583?v583.width|0:(v2.framebufferWidth-v584);
  v587="height" in v583?v583.height|0:(v2.framebufferHeight-v585);
  if(!(v586>=0&&v587>=0))g18.commandRaise(g103,g19);
  v1.scissor(v584,v585,v586,v587);
  v41[0]=v584;
  v41[1]=v585;
  v41[2]=v586;
  v41[3]=v587;
  v592=v574["colorBuffer"];
  v53.buffer=v592;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g113,g19);
  v593=false;
  v594=1;
  v595=0;
  v596=0;
  v597=0;
  v598=0;
  v599=null;
  v600=0;
  v601=false;
  v602=5126;
  v603=0;
  v604=0;
  v605=0;
  if(v16(v53)){
  v593=true;
  v599=v8.createStream(34962,v53);
  v602=v599.dtype;
  }
  else{
  v599=v8.getBuffer(v53);
  if(v599){
  v602=v599.dtype;
  }
  else if("constant" in v53){
  v594=2;
  if(typeof v53.constant === "number"){
  v595=v53.constant;
  v596=v597=v598=0;
  }
  else{
  v595=v53.constant.length>0?v53.constant[0]:0;
  v596=v53.constant.length>1?v53.constant[1]:0;
  v597=v53.constant.length>2?v53.constant[2]:0;
  v598=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v599=v8.createStream(34962,v53.buffer);
  }
  else{
  v599=v8.getBuffer(v53.buffer);
  }
  v602="type" in v53?v49[v53.type]:v599.dtype;
  v601=!!v53.normalized;
  v600=v53.size|0;
  v603=v53.offset|0;
  v604=v53.stride|0;
  v605=v53.divisor|0;
  }
  }
  v606=g127.location;
  v607=v10[v606];
  if(v594===1){
  if(!v607.buffer){
  v1.enableVertexAttribArray(v606);
  }
  v608=v600||4;
  if(v607.type!==v602||v607.size!==v608||v607.buffer!==v599||v607.normalized!==v601||v607.offset!==v603||v607.stride!==v604){
  v1.bindBuffer(34962,v599.buffer);
  v1.vertexAttribPointer(v606,v608,v602,v601,v604,v603);
  v607.type=v602;
  v607.size=v608;
  v607.buffer=v599;
  v607.normalized=v601;
  v607.offset=v603;
  v607.stride=v604;
  }
  if(v607.divisor!==v605){
  v572.vertexAttribDivisorANGLE(v606,v605);
  v607.divisor=v605;
  }
  }
  else{
  if(v607.buffer){
  v1.disableVertexAttribArray(v606);
  v607.buffer=null;
  }
  if(v607.x!==v595||v607.y!==v596||v607.z!==v597||v607.w!==v598){
  v1.vertexAttrib4f(v606,v595,v596,v597,v598);
  v607.x=v595;
  v607.y=v596;
  v607.z=v597;
  v607.w=v598;
  }
  }
  v609=v574["positionBuffer"];
  v56.buffer=v609;
  if(!(v56&&(typeof v56==="object"||typeof v56==="function")&&(v16(v56)||v8.getBuffer(v56)||v8.getBuffer(v56.buffer)||v16(v56.buffer)||("constant" in v56&&(typeof v56.constant==="number"||v17(v56.constant))))))g18.commandRaise(g132,g19);
  v610=false;
  v611=1;
  v612=0;
  v613=0;
  v614=0;
  v615=0;
  v616=null;
  v617=0;
  v618=false;
  v619=5126;
  v620=0;
  v621=0;
  v622=0;
  if(v16(v56)){
  v610=true;
  v616=v8.createStream(34962,v56);
  v619=v616.dtype;
  }
  else{
  v616=v8.getBuffer(v56);
  if(v616){
  v619=v616.dtype;
  }
  else if("constant" in v56){
  v611=2;
  if(typeof v56.constant === "number"){
  v612=v56.constant;
  v613=v614=v615=0;
  }
  else{
  v612=v56.constant.length>0?v56.constant[0]:0;
  v613=v56.constant.length>1?v56.constant[1]:0;
  v614=v56.constant.length>2?v56.constant[2]:0;
  v615=v56.constant.length>3?v56.constant[3]:0;
  }
  }
  else{
  if(v16(v56.buffer)){
  v616=v8.createStream(34962,v56.buffer);
  }
  else{
  v616=v8.getBuffer(v56.buffer);
  }
  v619="type" in v56?v49[v56.type]:v616.dtype;
  v618=!!v56.normalized;
  v617=v56.size|0;
  v620=v56.offset|0;
  v621=v56.stride|0;
  v622=v56.divisor|0;
  }
  }
  v623=g146.location;
  v624=v10[v623];
  if(v611===1){
  if(!v624.buffer){
  v1.enableVertexAttribArray(v623);
  }
  v625=v617||2;
  if(v624.type!==v619||v624.size!==v625||v624.buffer!==v616||v624.normalized!==v618||v624.offset!==v620||v624.stride!==v621){
  v1.bindBuffer(34962,v616.buffer);
  v1.vertexAttribPointer(v623,v625,v619,v618,v621,v620);
  v624.type=v619;
  v624.size=v625;
  v624.buffer=v616;
  v624.normalized=v618;
  v624.offset=v620;
  v624.stride=v621;
  }
  if(v624.divisor!==v622){
  v572.vertexAttribDivisorANGLE(v623,v622);
  v624.divisor=v622;
  }
  }
  else{
  if(v624.buffer){
  v1.disableVertexAttribArray(v623);
  v624.buffer=null;
  }
  if(v624.x!==v612||v624.y!==v613||v624.z!==v614||v624.w!==v615){
  v1.vertexAttrib4f(v623,v612,v613,v614,v615);
  v624.x=v612;
  v624.y=v613;
  v624.z=v614;
  v624.w=v615;
  }
  }
  v626=v574["colorBuffer"];
  v54.buffer=v626;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g151,g19);
  v627=false;
  v628=1;
  v629=0;
  v630=0;
  v631=0;
  v632=0;
  v633=null;
  v634=0;
  v635=false;
  v636=5126;
  v637=0;
  v638=0;
  v639=0;
  if(v16(v54)){
  v627=true;
  v633=v8.createStream(34962,v54);
  v636=v633.dtype;
  }
  else{
  v633=v8.getBuffer(v54);
  if(v633){
  v636=v633.dtype;
  }
  else if("constant" in v54){
  v628=2;
  if(typeof v54.constant === "number"){
  v629=v54.constant;
  v630=v631=v632=0;
  }
  else{
  v629=v54.constant.length>0?v54.constant[0]:0;
  v630=v54.constant.length>1?v54.constant[1]:0;
  v631=v54.constant.length>2?v54.constant[2]:0;
  v632=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v633=v8.createStream(34962,v54.buffer);
  }
  else{
  v633=v8.getBuffer(v54.buffer);
  }
  v636="type" in v54?v49[v54.type]:v633.dtype;
  v635=!!v54.normalized;
  v634=v54.size|0;
  v637=v54.offset|0;
  v638=v54.stride|0;
  v639=v54.divisor|0;
  }
  }
  v640=g165.location;
  v641=v10[v640];
  if(v628===1){
  if(!v641.buffer){
  v1.enableVertexAttribArray(v640);
  }
  v642=v634||4;
  if(v641.type!==v636||v641.size!==v642||v641.buffer!==v633||v641.normalized!==v635||v641.offset!==v637||v641.stride!==v638){
  v1.bindBuffer(34962,v633.buffer);
  v1.vertexAttribPointer(v640,v642,v636,v635,v638,v637);
  v641.type=v636;
  v641.size=v642;
  v641.buffer=v633;
  v641.normalized=v635;
  v641.offset=v637;
  v641.stride=v638;
  }
  if(v641.divisor!==v639){
  v572.vertexAttribDivisorANGLE(v640,v639);
  v641.divisor=v639;
  }
  }
  else{
  if(v641.buffer){
  v1.disableVertexAttribArray(v640);
  v641.buffer=null;
  }
  if(v641.x!==v629||v641.y!==v630||v641.z!==v631||v641.w!==v632){
  v1.vertexAttrib4f(v640,v629,v630,v631,v632);
  v641.x=v629;
  v641.y=v630;
  v641.z=v631;
  v641.w=v632;
  }
  }
  v643=v574["positionBuffer"];
  v57.buffer=v643;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g170,g19);
  v644=false;
  v645=1;
  v646=0;
  v647=0;
  v648=0;
  v649=0;
  v650=null;
  v651=0;
  v652=false;
  v653=5126;
  v654=0;
  v655=0;
  v656=0;
  if(v16(v57)){
  v644=true;
  v650=v8.createStream(34962,v57);
  v653=v650.dtype;
  }
  else{
  v650=v8.getBuffer(v57);
  if(v650){
  v653=v650.dtype;
  }
  else if("constant" in v57){
  v645=2;
  if(typeof v57.constant === "number"){
  v646=v57.constant;
  v647=v648=v649=0;
  }
  else{
  v646=v57.constant.length>0?v57.constant[0]:0;
  v647=v57.constant.length>1?v57.constant[1]:0;
  v648=v57.constant.length>2?v57.constant[2]:0;
  v649=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v650=v8.createStream(34962,v57.buffer);
  }
  else{
  v650=v8.getBuffer(v57.buffer);
  }
  v653="type" in v57?v49[v57.type]:v650.dtype;
  v652=!!v57.normalized;
  v651=v57.size|0;
  v654=v57.offset|0;
  v655=v57.stride|0;
  v656=v57.divisor|0;
  }
  }
  v657=g184.location;
  v658=v10[v657];
  if(v645===1){
  if(!v658.buffer){
  v1.enableVertexAttribArray(v657);
  }
  v659=v651||2;
  if(v658.type!==v653||v658.size!==v659||v658.buffer!==v650||v658.normalized!==v652||v658.offset!==v654||v658.stride!==v655){
  v1.bindBuffer(34962,v650.buffer);
  v1.vertexAttribPointer(v657,v659,v653,v652,v655,v654);
  v658.type=v653;
  v658.size=v659;
  v658.buffer=v650;
  v658.normalized=v652;
  v658.offset=v654;
  v658.stride=v655;
  }
  if(v658.divisor!==v656){
  v572.vertexAttribDivisorANGLE(v657,v656);
  v658.divisor=v656;
  }
  }
  else{
  if(v658.buffer){
  v1.disableVertexAttribArray(v657);
  v658.buffer=null;
  }
  if(v658.x!==v646||v658.y!==v647||v658.z!==v648||v658.w!==v649){
  v1.vertexAttrib4f(v657,v646,v647,v648,v649);
  v658.x=v646;
  v658.y=v647;
  v658.z=v648;
  v658.w=v649;
  }
  }
  v660=v574["positionBuffer"];
  v58.buffer=v660;
  if(!(v58&&(typeof v58==="object"||typeof v58==="function")&&(v16(v58)||v8.getBuffer(v58)||v8.getBuffer(v58.buffer)||v16(v58.buffer)||("constant" in v58&&(typeof v58.constant==="number"||v17(v58.constant))))))g18.commandRaise(g196,g19);
  v661=false;
  v662=1;
  v663=0;
  v664=0;
  v665=0;
  v666=0;
  v667=null;
  v668=0;
  v669=false;
  v670=5126;
  v671=0;
  v672=0;
  v673=0;
  if(v16(v58)){
  v661=true;
  v667=v8.createStream(34962,v58);
  v670=v667.dtype;
  }
  else{
  v667=v8.getBuffer(v58);
  if(v667){
  v670=v667.dtype;
  }
  else if("constant" in v58){
  v662=2;
  if(typeof v58.constant === "number"){
  v663=v58.constant;
  v664=v665=v666=0;
  }
  else{
  v663=v58.constant.length>0?v58.constant[0]:0;
  v664=v58.constant.length>1?v58.constant[1]:0;
  v665=v58.constant.length>2?v58.constant[2]:0;
  v666=v58.constant.length>3?v58.constant[3]:0;
  }
  }
  else{
  if(v16(v58.buffer)){
  v667=v8.createStream(34962,v58.buffer);
  }
  else{
  v667=v8.getBuffer(v58.buffer);
  }
  v670="type" in v58?v49[v58.type]:v667.dtype;
  v669=!!v58.normalized;
  v668=v58.size|0;
  v671=v58.offset|0;
  v672=v58.stride|0;
  v673=v58.divisor|0;
  }
  }
  v674=g210.location;
  v675=v10[v674];
  if(v662===1){
  if(!v675.buffer){
  v1.enableVertexAttribArray(v674);
  }
  v676=v668||2;
  if(v675.type!==v670||v675.size!==v676||v675.buffer!==v667||v675.normalized!==v669||v675.offset!==v671||v675.stride!==v672){
  v1.bindBuffer(34962,v667.buffer);
  v1.vertexAttribPointer(v674,v676,v670,v669,v672,v671);
  v675.type=v670;
  v675.size=v676;
  v675.buffer=v667;
  v675.normalized=v669;
  v675.offset=v671;
  v675.stride=v672;
  }
  if(v675.divisor!==v673){
  v572.vertexAttribDivisorANGLE(v674,v673);
  v675.divisor=v673;
  }
  }
  else{
  if(v675.buffer){
  v1.disableVertexAttribArray(v674);
  v675.buffer=null;
  }
  if(v675.x!==v663||v675.y!==v664||v675.z!==v665||v675.w!==v666){
  v1.vertexAttrib4f(v674,v663,v664,v665,v666);
  v675.x=v663;
  v675.y=v664;
  v675.z=v665;
  v675.w=v666;
  }
  }
  v677=v574["positionBuffer"];
  v55.buffer=v677;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g215,g19);
  v678=false;
  v679=1;
  v680=0;
  v681=0;
  v682=0;
  v683=0;
  v684=null;
  v685=0;
  v686=false;
  v687=5126;
  v688=0;
  v689=0;
  v690=0;
  if(v16(v55)){
  v678=true;
  v684=v8.createStream(34962,v55);
  v687=v684.dtype;
  }
  else{
  v684=v8.getBuffer(v55);
  if(v684){
  v687=v684.dtype;
  }
  else if("constant" in v55){
  v679=2;
  if(typeof v55.constant === "number"){
  v680=v55.constant;
  v681=v682=v683=0;
  }
  else{
  v680=v55.constant.length>0?v55.constant[0]:0;
  v681=v55.constant.length>1?v55.constant[1]:0;
  v682=v55.constant.length>2?v55.constant[2]:0;
  v683=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v684=v8.createStream(34962,v55.buffer);
  }
  else{
  v684=v8.getBuffer(v55.buffer);
  }
  v687="type" in v55?v49[v55.type]:v684.dtype;
  v686=!!v55.normalized;
  v685=v55.size|0;
  v688=v55.offset|0;
  v689=v55.stride|0;
  v690=v55.divisor|0;
  }
  }
  v691=g229.location;
  v692=v10[v691];
  if(v679===1){
  if(!v692.buffer){
  v1.enableVertexAttribArray(v691);
  }
  v693=v685||2;
  if(v692.type!==v687||v692.size!==v693||v692.buffer!==v684||v692.normalized!==v686||v692.offset!==v688||v692.stride!==v689){
  v1.bindBuffer(34962,v684.buffer);
  v1.vertexAttribPointer(v691,v693,v687,v686,v689,v688);
  v692.type=v687;
  v692.size=v693;
  v692.buffer=v684;
  v692.normalized=v686;
  v692.offset=v688;
  v692.stride=v689;
  }
  if(v692.divisor!==v690){
  v572.vertexAttribDivisorANGLE(v691,v690);
  v692.divisor=v690;
  }
  }
  else{
  if(v692.buffer){
  v1.disableVertexAttribArray(v691);
  v692.buffer=null;
  }
  if(v692.x!==v680||v692.y!==v681||v692.z!==v682||v692.w!==v683){
  v1.vertexAttrib4f(v691,v680,v681,v682,v683);
  v692.x=v680;
  v692.y=v681;
  v692.z=v682;
  v692.w=v683;
  }
  }
  v694=v574["dashLength"];
  if(!(typeof v694==="number"))g18.commandRaise(g235,g19);
  if(!v573||v695!==v694){
  v695=v694;
  v1.uniform1f(g233.location,v694);
  }
  v696=v574["dashTexture"];
  if(v696&&v696._reglType==="framebuffer"){
  v696=v696.color[0];
  }
  if(!(typeof v696==="function"&&v696._reglType==="texture2d"))g18.commandRaise(g238,g19);
  v697=v696._texture;
  v1.uniform1i(g236.location,v697.bind());
  v698=v574["depth"];
  if(!(typeof v698==="number"))g18.commandRaise(g242,g19);
  if(!v573||v699!==v698){
  v699=v698;
  v1.uniform1f(g240.location,v698);
  }
  v700=v574["miterLimit"];
  if(!(typeof v700==="number"))g18.commandRaise(g245,g19);
  if(!v573||v701!==v700){
  v701=v700;
  v1.uniform1f(g243.location,v700);
  }
  v702=g247.call(this,v2,v574,v573);
  if(!(typeof v702==="number"))g18.commandRaise(g249,g19);
  if(!v573||v703!==v702){
  v703=v702;
  v1.uniform1f(g246.location,v702);
  }
  v704=v574["opacity"];
  if(!(typeof v704==="number"))g18.commandRaise(g252,g19);
  if(!v573||v705!==v704){
  v705=v704;
  v1.uniform1f(g250.location,v704);
  }
  v706=v574["scale"];
  if(!(v17(v706)&&v706.length===2))g18.commandRaise(g255,g19);
  v707=v706[0];
  v709=v706[1];
  if(!v573||v708!==v707||v710!==v709){
  v708=v707;
  v710=v709;
  v1.uniform2f(g253.location,v707,v709);
  }
  v711=v574["thickness"];
  if(!(typeof v711==="number"))g18.commandRaise(g260,g19);
  if(!v573||v712!==v711){
  v712=v711;
  v1.uniform1f(g258.location,v711);
  }
  v713=v574["translate"];
  if(!(v17(v713)&&v713.length===2))g18.commandRaise(g263,g19);
  v714=v713[0];
  v716=v713[1];
  if(!v573||v715!==v714||v717!==v716){
  v715=v714;
  v717=v716;
  v1.uniform2f(g261.location,v714,v716);
  }
  v718=g267.call(this,v2,v574,v573);
  if(!(v17(v718)&&v718.length===4))g18.commandRaise(g269,g19);
  v719=v718[0];
  v721=v718[1];
  v723=v718[2];
  v725=v718[3];
  if(!v573||v720!==v719||v722!==v721||v724!==v723||v726!==v725){
  v720=v719;
  v722=v721;
  v724=v723;
  v726=v725;
  v1.uniform4f(g266.location,v719,v721,v723,v725);
  }
  v728=v574["count"];
  if(v728>0){
  if(v727){
  v572.drawElementsInstancedANGLE(5,4,v727.type,0<<((v727.type-5121)>>1),v728);
  }
  else{
  v572.drawArraysInstancedANGLE(5,0,4,v728);
  }
  }
  else if(v728<0){
  if(v727){
  v1.drawElements(5,4,v727.type,0<<((v727.type-5121)>>1));
  }
  else{
  v1.drawArrays(5,0,4);
  }
  }
  v2.viewportWidth=v580;
  v2.viewportHeight=v581;
  if(v593){
  v8.destroyStream(v599);
  }
  if(v610){
  v8.destroyStream(v616);
  }
  if(v627){
  v8.destroyStream(v633);
  }
  if(v644){
  v8.destroyStream(v650);
  }
  if(v661){
  v8.destroyStream(v667);
  }
  if(v678){
  v8.destroyStream(v684);
  }
  v697.unbind();
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v570){
  g52.cpuTime+=performance.now()-v571;
  }
  }
  ,}
  
  },
  "30529.147": function (_gs, g0, g18, g19, g52, g90, g98, g105, g108, g122, g127, g141, g145, g147, g152, g154, g155, g157, g158, g160, g163, g165, g168, g170, g173, g175, g178, g182, g184, g246, g263, g290) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v54;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v53.stride=8;
  v53.offset=8;
  v54={
  }
  ;
  v54.stride=8;
  v54.offset=8;
  return {
  "draw":function(a0){
  var v55,v56,v89,v91,v92,v93,v94,v95,v96,v97,v99,v100,v101,v102,v103,v104,v106,v107,v109,v110,v111,v112,v113,v114,v115,v116,v117,v118,v119,v120,v121,v123,v124,v125,v126,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v142,v143,v144,v146,v148,v149,v150,v151,v153,v156,v159,v161,v162,v164,v166,v167,v169,v171,v172,v174,v176,v177,v179,v180,v181,v183,v185;
  v55=v14.angle_instanced_arrays;
  v56=v13.next;
  if(v56!==v13.cur){
  if(v56){
  v1.bindFramebuffer(36160,v56.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v56;
  }
  if(v5.dirty){
  var v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88;
  v57=v4.dither;
  if(v57!==v5.dither){
  if(v57){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v57;
  }
  v58=v4.depth_func;
  if(v58!==v5.depth_func){
  v1.depthFunc(v58);
  v5.depth_func=v58;
  }
  v59=v26[0];
  v60=v26[1];
  if(v59!==v27[0]||v60!==v27[1]){
  v1.depthRange(v59,v60);
  v27[0]=v59;
  v27[1]=v60;
  }
  v61=v4.depth_mask;
  if(v61!==v5.depth_mask){
  v1.depthMask(v61);
  v5.depth_mask=v61;
  }
  v62=v28[0];
  v63=v28[1];
  v64=v28[2];
  v65=v28[3];
  if(v62!==v29[0]||v63!==v29[1]||v64!==v29[2]||v65!==v29[3]){
  v1.colorMask(v62,v63,v64,v65);
  v29[0]=v62;
  v29[1]=v63;
  v29[2]=v64;
  v29[3]=v65;
  }
  v66=v4.cull_enable;
  if(v66!==v5.cull_enable){
  if(v66){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v66;
  }
  v67=v4.cull_face;
  if(v67!==v5.cull_face){
  v1.cullFace(v67);
  v5.cull_face=v67;
  }
  v68=v4.frontFace;
  if(v68!==v5.frontFace){
  v1.frontFace(v68);
  v5.frontFace=v68;
  }
  v69=v4.lineWidth;
  if(v69!==v5.lineWidth){
  v1.lineWidth(v69);
  v5.lineWidth=v69;
  }
  v70=v4.polygonOffset_enable;
  if(v70!==v5.polygonOffset_enable){
  if(v70){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v70;
  }
  v71=v30[0];
  v72=v30[1];
  if(v71!==v31[0]||v72!==v31[1]){
  v1.polygonOffset(v71,v72);
  v31[0]=v71;
  v31[1]=v72;
  }
  v73=v4.sample_alpha;
  if(v73!==v5.sample_alpha){
  if(v73){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v73;
  }
  v74=v4.sample_enable;
  if(v74!==v5.sample_enable){
  if(v74){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v74;
  }
  v75=v32[0];
  v76=v32[1];
  if(v75!==v33[0]||v76!==v33[1]){
  v1.sampleCoverage(v75,v76);
  v33[0]=v75;
  v33[1]=v76;
  }
  v77=v4.stencil_mask;
  if(v77!==v5.stencil_mask){
  v1.stencilMask(v77);
  v5.stencil_mask=v77;
  }
  v78=v34[0];
  v79=v34[1];
  v80=v34[2];
  if(v78!==v35[0]||v79!==v35[1]||v80!==v35[2]){
  v1.stencilFunc(v78,v79,v80);
  v35[0]=v78;
  v35[1]=v79;
  v35[2]=v80;
  }
  v81=v36[0];
  v82=v36[1];
  v83=v36[2];
  v84=v36[3];
  if(v81!==v37[0]||v82!==v37[1]||v83!==v37[2]||v84!==v37[3]){
  v1.stencilOpSeparate(v81,v82,v83,v84);
  v37[0]=v81;
  v37[1]=v82;
  v37[2]=v83;
  v37[3]=v84;
  }
  v85=v38[0];
  v86=v38[1];
  v87=v38[2];
  v88=v38[3];
  if(v85!==v39[0]||v86!==v39[1]||v87!==v39[2]||v88!==v39[3]){
  v1.stencilOpSeparate(v85,v86,v87,v88);
  v39[0]=v85;
  v39[1]=v86;
  v39[2]=v87;
  v39[3]=v88;
  }
  }
  v89=a0["viewport"];
  if(!(v89&&typeof v89==="object"))g18.commandRaise(g90,g19);
  v91=v89.x|0;
  v92=v89.y|0;
  v93="width" in v89?v89.width|0:(v2.framebufferWidth-v91);
  v94="height" in v89?v89.height|0:(v2.framebufferHeight-v92);
  if(!(v93>=0&&v94>=0))g18.commandRaise(g90,g19);
  v95=v2.viewportWidth;
  v2.viewportWidth=v93;
  v96=v2.viewportHeight;
  v2.viewportHeight=v94;
  v1.viewport(v91,v92,v93,v94);
  v43[0]=v91;
  v43[1]=v92;
  v43[2]=v93;
  v43[3]=v94;
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[3];
  v97=a0["viewport"];
  if(!(v97&&typeof v97==="object"))g18.commandRaise(g98,g19);
  v99=v97.x|0;
  v100=v97.y|0;
  v101="width" in v97?v97.width|0:(v2.framebufferWidth-v99);
  v102="height" in v97?v97.height|0:(v2.framebufferHeight-v100);
  if(!(v101>=0&&v102>=0))g18.commandRaise(g98,g19);
  v1.scissor(v99,v100,v101,v102);
  v41[0]=v99;
  v41[1]=v100;
  v41[2]=v101;
  v41[3]=v102;
  if(_gs[4]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[5];
  if(_gs[6]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[7];
  v103=v5.profile;
  if(v103){
  v104=performance.now();
  g52.count++;
  }
  v1.useProgram(g105.program);
  v106=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v107=a0["positionBuffer"];
  v53.buffer=v107;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g108,g19);
  v109=false;
  v110=1;
  v111=0;
  v112=0;
  v113=0;
  v114=0;
  v115=null;
  v116=0;
  v117=false;
  v118=5126;
  v119=0;
  v120=0;
  v121=0;
  if(v16(v53)){
  v109=true;
  v115=v8.createStream(34962,v53);
  v118=v115.dtype;
  }
  else{
  v115=v8.getBuffer(v53);
  if(v115){
  v118=v115.dtype;
  }
  else if("constant" in v53){
  v110=2;
  if(typeof v53.constant === "number"){
  v111=v53.constant;
  v112=v113=v114=0;
  }
  else{
  v111=v53.constant.length>0?v53.constant[0]:0;
  v112=v53.constant.length>1?v53.constant[1]:0;
  v113=v53.constant.length>2?v53.constant[2]:0;
  v114=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v115=v8.createStream(34962,v53.buffer);
  }
  else{
  v115=v8.getBuffer(v53.buffer);
  }
  v118="type" in v53?v49[v53.type]:v115.dtype;
  v117=!!v53.normalized;
  v116=v53.size|0;
  v119=v53.offset|0;
  v120=v53.stride|0;
  v121=v53.divisor|0;
  }
  }
  v123=g122.location;
  v124=v10[v123];
  if(v110===1){
  if(!v124.buffer){
  v1.enableVertexAttribArray(v123);
  }
  v125=v116||2;
  if(v124.type!==v118||v124.size!==v125||v124.buffer!==v115||v124.normalized!==v117||v124.offset!==v119||v124.stride!==v120){
  v1.bindBuffer(34962,v115.buffer);
  v1.vertexAttribPointer(v123,v125,v118,v117,v120,v119);
  v124.type=v118;
  v124.size=v125;
  v124.buffer=v115;
  v124.normalized=v117;
  v124.offset=v119;
  v124.stride=v120;
  }
  if(v124.divisor!==v121){
  v106.vertexAttribDivisorANGLE(v123,v121);
  v124.divisor=v121;
  }
  }
  else{
  if(v124.buffer){
  v1.disableVertexAttribArray(v123);
  v124.buffer=null;
  }
  if(v124.x!==v111||v124.y!==v112||v124.z!==v113||v124.w!==v114){
  v1.vertexAttrib4f(v123,v111,v112,v113,v114);
  v124.x=v111;
  v124.y=v112;
  v124.z=v113;
  v124.w=v114;
  }
  }
  v126=a0["positionFractBuffer"];
  v54.buffer=v126;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g127,g19);
  v128=false;
  v129=1;
  v130=0;
  v131=0;
  v132=0;
  v133=0;
  v134=null;
  v135=0;
  v136=false;
  v137=5126;
  v138=0;
  v139=0;
  v140=0;
  if(v16(v54)){
  v128=true;
  v134=v8.createStream(34962,v54);
  v137=v134.dtype;
  }
  else{
  v134=v8.getBuffer(v54);
  if(v134){
  v137=v134.dtype;
  }
  else if("constant" in v54){
  v129=2;
  if(typeof v54.constant === "number"){
  v130=v54.constant;
  v131=v132=v133=0;
  }
  else{
  v130=v54.constant.length>0?v54.constant[0]:0;
  v131=v54.constant.length>1?v54.constant[1]:0;
  v132=v54.constant.length>2?v54.constant[2]:0;
  v133=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v134=v8.createStream(34962,v54.buffer);
  }
  else{
  v134=v8.getBuffer(v54.buffer);
  }
  v137="type" in v54?v49[v54.type]:v134.dtype;
  v136=!!v54.normalized;
  v135=v54.size|0;
  v138=v54.offset|0;
  v139=v54.stride|0;
  v140=v54.divisor|0;
  }
  }
  v142=g141.location;
  v143=v10[v142];
  if(v129===1){
  if(!v143.buffer){
  v1.enableVertexAttribArray(v142);
  }
  v144=v135||2;
  if(v143.type!==v137||v143.size!==v144||v143.buffer!==v134||v143.normalized!==v136||v143.offset!==v138||v143.stride!==v139){
  v1.bindBuffer(34962,v134.buffer);
  v1.vertexAttribPointer(v142,v144,v137,v136,v139,v138);
  v143.type=v137;
  v143.size=v144;
  v143.buffer=v134;
  v143.normalized=v136;
  v143.offset=v138;
  v143.stride=v139;
  }
  if(v143.divisor!==v140){
  v106.vertexAttribDivisorANGLE(v142,v140);
  v143.divisor=v140;
  }
  }
  else{
  if(v143.buffer){
  v1.disableVertexAttribArray(v142);
  v143.buffer=null;
  }
  if(v143.x!==v130||v143.y!==v131||v143.z!==v132||v143.w!==v133){
  v1.vertexAttrib4f(v142,v130,v131,v132,v133);
  v143.x=v130;
  v143.y=v131;
  v143.z=v132;
  v143.w=v133;
  }
  }
  v146=a0["fill"];
  if(!(v17(v146)&&v146.length===4))g18.commandRaise(g147,g19);
  v148=v146[0];
  v149=v146[1];
  v150=v146[2];
  v151=v146[3];
  v1.uniform4f(g145.location,v148,v149,v150,v151);
  v153=a0["id"];
  if(!(typeof v153==="number"))g18.commandRaise(g154,g19);
  v1.uniform1f(g152.location,v153);
  v156=a0["opacity"];
  if(!(typeof v156==="number"))g18.commandRaise(g157,g19);
  v1.uniform1f(g155.location,v156);
  v159=a0["scale"];
  if(!(v17(v159)&&v159.length===2))g18.commandRaise(g160,g19);
  v161=v159[0];
  v162=v159[1];
  v1.uniform2f(g158.location,v161,v162);
  v164=a0["scaleFract"];
  if(!(v17(v164)&&v164.length===2))g18.commandRaise(g165,g19);
  v166=v164[0];
  v167=v164[1];
  v1.uniform2f(g163.location,v166,v167);
  v169=a0["translate"];
  if(!(v17(v169)&&v169.length===2))g18.commandRaise(g170,g19);
  v171=v169[0];
  v172=v169[1];
  v1.uniform2f(g168.location,v171,v172);
  v174=a0["translateFract"];
  if(!(v17(v174)&&v174.length===2))g18.commandRaise(g175,g19);
  v176=v174[0];
  v177=v174[1];
  v1.uniform2f(g173.location,v176,v177);
  v179=g178.call(this,v2,a0,0);
  v180=null;
  v181=v16(v179);
  if(v181){
  v180=v7.createStream(v179);
  }
  else{
  v180=v7.getElements(v179);
  if(!(!v179||v180))g18.commandRaise(g182,g19);
  }
  if(v180)v1.bindBuffer(34963,v180.buffer.buffer);
  v183=v180?v180.vertCount:-1;
  if(!(v183>=0))g18.commandRaise(g184,g19);
  if(v183){
  v185=v6.instances;
  if(v185>0){
  if(v180){
  v106.drawElementsInstancedANGLE(4,v183,v180.type,0<<((v180.type-5121)>>1),v185);
  }
  else{
  v106.drawArraysInstancedANGLE(4,0,v183,v185);
  }
  }
  else if(v185<0){
  if(v180){
  v1.drawElements(4,v183,v180.type,0<<((v180.type-5121)>>1));
  }
  else{
  v1.drawArrays(4,0,v183);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v95;
  v2.viewportHeight=v96;
  if(v103){
  g52.cpuTime+=performance.now()-v104;
  }
  if(v109){
  v8.destroyStream(v115);
  }
  if(v128){
  v8.destroyStream(v134);
  }
  if(v181){
  v7.destroyStream(v180);
  }
  }
  }
  ,"scope":function(a0,a1,a2){
  var v186,v187,v188,v189,v190,v191,v192,v193,v194,v195,v196,v197,v198,v199,v200,v201,v202,v203,v204,v205,v206,v207,v208,v209,v210,v211,v212,v213,v214,v215,v216,v217,v218,v219,v220,v221,v222,v223,v224,v225,v226,v227,v228,v229,v230,v231,v232,v233,v234,v235,v236,v237,v238,v239,v240,v241,v242,v243,v244,v245,v247,v248,v249,v250,v251,v252,v253,v254,v255,v256,v257,v258,v259,v260,v261,v262,v264,v265,v266,v267,v268,v269,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v301,v302,v303,v304;
  v186=a0["viewport"];
  if(!(v186&&typeof v186==="object"))g18.commandRaise(g90,g19);
  v187=v186.x|0;
  v188=v186.y|0;
  v189="width" in v186?v186.width|0:(v2.framebufferWidth-v187);
  v190="height" in v186?v186.height|0:(v2.framebufferHeight-v188);
  if(!(v189>=0&&v190>=0))g18.commandRaise(g90,g19);
  v191=v2.viewportWidth;
  v2.viewportWidth=v189;
  v192=v2.viewportHeight;
  v2.viewportHeight=v190;
  v193=v42[0];
  v42[0]=_gs[8];
  v194=v42[1];
  v42[1]=_gs[9];
  v195=v42[2];
  v42[2]=_gs[10];
  v196=v42[3];
  v42[3]=_gs[11];
  v197=v20[0];
  v20[0]=_gs[12];
  v198=v20[1];
  v20[1]=_gs[13];
  v199=v20[2];
  v20[2]=_gs[14];
  v200=v20[3];
  v20[3]=_gs[15];
  v201=v4.blend_enable;
  v4.blend_enable=_gs[16];
  v202=v22[0];
  v22[0]=_gs[17];
  v203=v22[1];
  v22[1]=_gs[18];
  v204=v24[0];
  v24[0]=_gs[19];
  v205=v24[1];
  v24[1]=_gs[20];
  v206=v24[2];
  v24[2]=_gs[21];
  v207=v24[3];
  v24[3]=_gs[22];
  v208=v4.depth_enable;
  v4.depth_enable=_gs[23];
  v209=a0["viewport"];
  if(!(v209&&typeof v209==="object"))g18.commandRaise(g98,g19);
  v210=v209.x|0;
  v211=v209.y|0;
  v212="width" in v209?v209.width|0:(v2.framebufferWidth-v210);
  v213="height" in v209?v209.height|0:(v2.framebufferHeight-v211);
  if(!(v212>=0&&v213>=0))g18.commandRaise(g98,g19);
  v214=v40[0];
  v40[0]=_gs[24];
  v215=v40[1];
  v40[1]=_gs[25];
  v216=v40[2];
  v40[2]=_gs[26];
  v217=v40[3];
  v40[3]=_gs[27];
  v218=v4.scissor_enable;
  v4.scissor_enable=_gs[28];
  v219=v4.stencil_enable;
  v4.stencil_enable=_gs[29];
  v220=v5.profile;
  if(v220){
  v221=performance.now();
  g52.count++;
  }
  v222=g178.call(this,v2,a0,a2);
  v223=null;
  v224=v16(v222);
  if(v224){
  v223=v7.createStream(v222);
  }
  else{
  v223=v7.getElements(v222);
  if(!(!v222||v223))g18.commandRaise(g182,g19);
  }
  v225=v6.elements;
  v6.elements=_gs[30];
  v226=v6.offset;
  v6.offset=_gs[31];
  v227=v223?v223.vertCount:-1;
  v228=v6.count;
  v6.count=_gs[32];
  v229=v6.primitive;
  v6.primitive=_gs[33];
  v230=a0["scale"];
  v231=v12[_gs[34]];
  v12[_gs[34]]=v230;
  v232=a0["fill"];
  v233=v12[_gs[35]];
  v12[_gs[35]]=v232;
  v234=a0["scaleFract"];
  v235=v12[_gs[36]];
  v12[_gs[36]]=v234;
  v236=a0["translateFract"];
  v237=v12[_gs[37]];
  v12[_gs[37]]=v236;
  v238=a0["translate"];
  v239=v12[_gs[38]];
  v12[_gs[38]]=v238;
  v240=a0["opacity"];
  v241=v12[_gs[39]];
  v12[_gs[39]]=v240;
  v242=v2["pixelRatio"];
  v243=v12[_gs[40]];
  v12[_gs[40]]=v242;
  v244=a0["id"];
  v245=v12[_gs[41]];
  v12[_gs[41]]=v244;
  v247=g246.call(this,v2,a0,a2);
  v248=v12[_gs[42]];
  v12[_gs[42]]=v247;
  v249=a0["positionBuffer"];
  v53.buffer=v249;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g108,g19);
  v250=false;
  v251=1;
  v252=0;
  v253=0;
  v254=0;
  v255=0;
  v256=null;
  v257=0;
  v258=false;
  v259=5126;
  v260=0;
  v261=0;
  v262=0;
  if(v16(v53)){
  v250=true;
  v256=v8.createStream(34962,v53);
  v259=v256.dtype;
  }
  else{
  v256=v8.getBuffer(v53);
  if(v256){
  v259=v256.dtype;
  }
  else if("constant" in v53){
  v251=2;
  if(typeof v53.constant === "number"){
  v252=v53.constant;
  v253=v254=v255=0;
  }
  else{
  v252=v53.constant.length>0?v53.constant[0]:0;
  v253=v53.constant.length>1?v53.constant[1]:0;
  v254=v53.constant.length>2?v53.constant[2]:0;
  v255=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v256=v8.createStream(34962,v53.buffer);
  }
  else{
  v256=v8.getBuffer(v53.buffer);
  }
  v259="type" in v53?v49[v53.type]:v256.dtype;
  v258=!!v53.normalized;
  v257=v53.size|0;
  v260=v53.offset|0;
  v261=v53.stride|0;
  v262=v53.divisor|0;
  }
  }
  v264=g263.state;
  g263.state=v251;
  v265=g263.x;
  g263.x=v252;
  v266=g263.y;
  g263.y=v253;
  v267=g263.z;
  g263.z=v254;
  v268=g263.w;
  g263.w=v255;
  v269=g263.buffer;
  g263.buffer=v256;
  v270=g263.size;
  g263.size=v257;
  v271=g263.normalized;
  g263.normalized=v258;
  v272=g263.type;
  g263.type=v259;
  v273=g263.offset;
  g263.offset=v260;
  v274=g263.stride;
  g263.stride=v261;
  v275=g263.divisor;
  g263.divisor=v262;
  v276=a0["positionFractBuffer"];
  v54.buffer=v276;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g127,g19);
  v277=false;
  v278=1;
  v279=0;
  v280=0;
  v281=0;
  v282=0;
  v283=null;
  v284=0;
  v285=false;
  v286=5126;
  v287=0;
  v288=0;
  v289=0;
  if(v16(v54)){
  v277=true;
  v283=v8.createStream(34962,v54);
  v286=v283.dtype;
  }
  else{
  v283=v8.getBuffer(v54);
  if(v283){
  v286=v283.dtype;
  }
  else if("constant" in v54){
  v278=2;
  if(typeof v54.constant === "number"){
  v279=v54.constant;
  v280=v281=v282=0;
  }
  else{
  v279=v54.constant.length>0?v54.constant[0]:0;
  v280=v54.constant.length>1?v54.constant[1]:0;
  v281=v54.constant.length>2?v54.constant[2]:0;
  v282=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v283=v8.createStream(34962,v54.buffer);
  }
  else{
  v283=v8.getBuffer(v54.buffer);
  }
  v286="type" in v54?v49[v54.type]:v283.dtype;
  v285=!!v54.normalized;
  v284=v54.size|0;
  v287=v54.offset|0;
  v288=v54.stride|0;
  v289=v54.divisor|0;
  }
  }
  v291=g290.state;
  g290.state=v278;
  v292=g290.x;
  g290.x=v279;
  v293=g290.y;
  g290.y=v280;
  v294=g290.z;
  g290.z=v281;
  v295=g290.w;
  g290.w=v282;
  v296=g290.buffer;
  g290.buffer=v283;
  v297=g290.size;
  g290.size=v284;
  v298=g290.normalized;
  g290.normalized=v285;
  v299=g290.type;
  g290.type=v286;
  v300=g290.offset;
  g290.offset=v287;
  v301=g290.stride;
  g290.stride=v288;
  v302=g290.divisor;
  g290.divisor=v289;
  v303=v9.vert;
  v9.vert=_gs[43];
  v304=v9.frag;
  v9.frag=_gs[44];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v191;
  v2.viewportHeight=v192;
  v42[0]=v193;
  v42[1]=v194;
  v42[2]=v195;
  v42[3]=v196;
  v20[0]=v197;
  v20[1]=v198;
  v20[2]=v199;
  v20[3]=v200;
  v4.blend_enable=v201;
  v22[0]=v202;
  v22[1]=v203;
  v24[0]=v204;
  v24[1]=v205;
  v24[2]=v206;
  v24[3]=v207;
  v4.depth_enable=v208;
  v40[0]=v214;
  v40[1]=v215;
  v40[2]=v216;
  v40[3]=v217;
  v4.scissor_enable=v218;
  v4.stencil_enable=v219;
  if(v220){
  g52.cpuTime+=performance.now()-v221;
  }
  if(v224){
  v7.destroyStream(v223);
  }
  v6.elements=v225;
  v6.offset=v226;
  v6.count=v228;
  v6.primitive=v229;
  v12[_gs[34]]=v231;
  v12[_gs[35]]=v233;
  v12[_gs[36]]=v235;
  v12[_gs[37]]=v237;
  v12[_gs[38]]=v239;
  v12[_gs[39]]=v241;
  v12[_gs[40]]=v243;
  v12[_gs[41]]=v245;
  v12[_gs[42]]=v248;
  if(v250){
  v8.destroyStream(v256);
  }
  g263.state=v264;
  g263.x=v265;
  g263.y=v266;
  g263.z=v267;
  g263.w=v268;
  g263.buffer=v269;
  g263.size=v270;
  g263.normalized=v271;
  g263.type=v272;
  g263.offset=v273;
  g263.stride=v274;
  g263.divisor=v275;
  if(v277){
  v8.destroyStream(v283);
  }
  g290.state=v291;
  g290.x=v292;
  g290.y=v293;
  g290.z=v294;
  g290.w=v295;
  g290.buffer=v296;
  g290.size=v297;
  g290.normalized=v298;
  g290.type=v299;
  g290.offset=v300;
  g290.stride=v301;
  g290.divisor=v302;
  v9.vert=v303;
  v9.frag=v304;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v305,v306,v339,v340,v341,v342,v343;
  v305=v14.angle_instanced_arrays;
  v306=v13.next;
  if(v306!==v13.cur){
  if(v306){
  v1.bindFramebuffer(36160,v306.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v306;
  }
  if(v5.dirty){
  var v307,v308,v309,v310,v311,v312,v313,v314,v315,v316,v317,v318,v319,v320,v321,v322,v323,v324,v325,v326,v327,v328,v329,v330,v331,v332,v333,v334,v335,v336,v337,v338;
  v307=v4.dither;
  if(v307!==v5.dither){
  if(v307){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v307;
  }
  v308=v4.depth_func;
  if(v308!==v5.depth_func){
  v1.depthFunc(v308);
  v5.depth_func=v308;
  }
  v309=v26[0];
  v310=v26[1];
  if(v309!==v27[0]||v310!==v27[1]){
  v1.depthRange(v309,v310);
  v27[0]=v309;
  v27[1]=v310;
  }
  v311=v4.depth_mask;
  if(v311!==v5.depth_mask){
  v1.depthMask(v311);
  v5.depth_mask=v311;
  }
  v312=v28[0];
  v313=v28[1];
  v314=v28[2];
  v315=v28[3];
  if(v312!==v29[0]||v313!==v29[1]||v314!==v29[2]||v315!==v29[3]){
  v1.colorMask(v312,v313,v314,v315);
  v29[0]=v312;
  v29[1]=v313;
  v29[2]=v314;
  v29[3]=v315;
  }
  v316=v4.cull_enable;
  if(v316!==v5.cull_enable){
  if(v316){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v316;
  }
  v317=v4.cull_face;
  if(v317!==v5.cull_face){
  v1.cullFace(v317);
  v5.cull_face=v317;
  }
  v318=v4.frontFace;
  if(v318!==v5.frontFace){
  v1.frontFace(v318);
  v5.frontFace=v318;
  }
  v319=v4.lineWidth;
  if(v319!==v5.lineWidth){
  v1.lineWidth(v319);
  v5.lineWidth=v319;
  }
  v320=v4.polygonOffset_enable;
  if(v320!==v5.polygonOffset_enable){
  if(v320){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v320;
  }
  v321=v30[0];
  v322=v30[1];
  if(v321!==v31[0]||v322!==v31[1]){
  v1.polygonOffset(v321,v322);
  v31[0]=v321;
  v31[1]=v322;
  }
  v323=v4.sample_alpha;
  if(v323!==v5.sample_alpha){
  if(v323){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v323;
  }
  v324=v4.sample_enable;
  if(v324!==v5.sample_enable){
  if(v324){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v324;
  }
  v325=v32[0];
  v326=v32[1];
  if(v325!==v33[0]||v326!==v33[1]){
  v1.sampleCoverage(v325,v326);
  v33[0]=v325;
  v33[1]=v326;
  }
  v327=v4.stencil_mask;
  if(v327!==v5.stencil_mask){
  v1.stencilMask(v327);
  v5.stencil_mask=v327;
  }
  v328=v34[0];
  v329=v34[1];
  v330=v34[2];
  if(v328!==v35[0]||v329!==v35[1]||v330!==v35[2]){
  v1.stencilFunc(v328,v329,v330);
  v35[0]=v328;
  v35[1]=v329;
  v35[2]=v330;
  }
  v331=v36[0];
  v332=v36[1];
  v333=v36[2];
  v334=v36[3];
  if(v331!==v37[0]||v332!==v37[1]||v333!==v37[2]||v334!==v37[3]){
  v1.stencilOpSeparate(v331,v332,v333,v334);
  v37[0]=v331;
  v37[1]=v332;
  v37[2]=v333;
  v37[3]=v334;
  }
  v335=v38[0];
  v336=v38[1];
  v337=v38[2];
  v338=v38[3];
  if(v335!==v39[0]||v336!==v39[1]||v337!==v39[2]||v338!==v39[3]){
  v1.stencilOpSeparate(v335,v336,v337,v338);
  v39[0]=v335;
  v39[1]=v336;
  v39[2]=v337;
  v39[3]=v338;
  }
  }
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[45]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[46];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[47]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[48];
  if(_gs[49]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[50];
  if(_gs[51]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[52];
  v339=v5.profile;
  if(v339){
  v340=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g105.program);
  v341=v14.angle_instanced_arrays;
  var v427;
  v11.setVAO(null);
  v427=v6.instances;
  for(v342=0;
  v342<a1;
  ++v342){
  v343=a0[v342];
  var v344,v345,v346,v347,v348,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v375,v376,v377,v378,v379,v380,v381,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v403,v404,v405,v406,v407,v408,v409,v410,v411,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v426;
  v344=v343["viewport"];
  if(!(v344&&typeof v344==="object"))g18.commandRaise(g90,g19);
  v345=v344.x|0;
  v346=v344.y|0;
  v347="width" in v344?v344.width|0:(v2.framebufferWidth-v345);
  v348="height" in v344?v344.height|0:(v2.framebufferHeight-v346);
  if(!(v347>=0&&v348>=0))g18.commandRaise(g90,g19);
  v349=v2.viewportWidth;
  v2.viewportWidth=v347;
  v350=v2.viewportHeight;
  v2.viewportHeight=v348;
  v1.viewport(v345,v346,v347,v348);
  v43[0]=v345;
  v43[1]=v346;
  v43[2]=v347;
  v43[3]=v348;
  v351=v343["viewport"];
  if(!(v351&&typeof v351==="object"))g18.commandRaise(g98,g19);
  v352=v351.x|0;
  v353=v351.y|0;
  v354="width" in v351?v351.width|0:(v2.framebufferWidth-v352);
  v355="height" in v351?v351.height|0:(v2.framebufferHeight-v353);
  if(!(v354>=0&&v355>=0))g18.commandRaise(g98,g19);
  v1.scissor(v352,v353,v354,v355);
  v41[0]=v352;
  v41[1]=v353;
  v41[2]=v354;
  v41[3]=v355;
  v356=v343["positionBuffer"];
  v53.buffer=v356;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g108,g19);
  v357=false;
  v358=1;
  v359=0;
  v360=0;
  v361=0;
  v362=0;
  v363=null;
  v364=0;
  v365=false;
  v366=5126;
  v367=0;
  v368=0;
  v369=0;
  if(v16(v53)){
  v357=true;
  v363=v8.createStream(34962,v53);
  v366=v363.dtype;
  }
  else{
  v363=v8.getBuffer(v53);
  if(v363){
  v366=v363.dtype;
  }
  else if("constant" in v53){
  v358=2;
  if(typeof v53.constant === "number"){
  v359=v53.constant;
  v360=v361=v362=0;
  }
  else{
  v359=v53.constant.length>0?v53.constant[0]:0;
  v360=v53.constant.length>1?v53.constant[1]:0;
  v361=v53.constant.length>2?v53.constant[2]:0;
  v362=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v363=v8.createStream(34962,v53.buffer);
  }
  else{
  v363=v8.getBuffer(v53.buffer);
  }
  v366="type" in v53?v49[v53.type]:v363.dtype;
  v365=!!v53.normalized;
  v364=v53.size|0;
  v367=v53.offset|0;
  v368=v53.stride|0;
  v369=v53.divisor|0;
  }
  }
  v370=g122.location;
  v371=v10[v370];
  if(v358===1){
  if(!v371.buffer){
  v1.enableVertexAttribArray(v370);
  }
  v372=v364||2;
  if(v371.type!==v366||v371.size!==v372||v371.buffer!==v363||v371.normalized!==v365||v371.offset!==v367||v371.stride!==v368){
  v1.bindBuffer(34962,v363.buffer);
  v1.vertexAttribPointer(v370,v372,v366,v365,v368,v367);
  v371.type=v366;
  v371.size=v372;
  v371.buffer=v363;
  v371.normalized=v365;
  v371.offset=v367;
  v371.stride=v368;
  }
  if(v371.divisor!==v369){
  v341.vertexAttribDivisorANGLE(v370,v369);
  v371.divisor=v369;
  }
  }
  else{
  if(v371.buffer){
  v1.disableVertexAttribArray(v370);
  v371.buffer=null;
  }
  if(v371.x!==v359||v371.y!==v360||v371.z!==v361||v371.w!==v362){
  v1.vertexAttrib4f(v370,v359,v360,v361,v362);
  v371.x=v359;
  v371.y=v360;
  v371.z=v361;
  v371.w=v362;
  }
  }
  v373=v343["positionFractBuffer"];
  v54.buffer=v373;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g127,g19);
  v374=false;
  v375=1;
  v376=0;
  v377=0;
  v378=0;
  v379=0;
  v380=null;
  v381=0;
  v382=false;
  v383=5126;
  v384=0;
  v385=0;
  v386=0;
  if(v16(v54)){
  v374=true;
  v380=v8.createStream(34962,v54);
  v383=v380.dtype;
  }
  else{
  v380=v8.getBuffer(v54);
  if(v380){
  v383=v380.dtype;
  }
  else if("constant" in v54){
  v375=2;
  if(typeof v54.constant === "number"){
  v376=v54.constant;
  v377=v378=v379=0;
  }
  else{
  v376=v54.constant.length>0?v54.constant[0]:0;
  v377=v54.constant.length>1?v54.constant[1]:0;
  v378=v54.constant.length>2?v54.constant[2]:0;
  v379=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v380=v8.createStream(34962,v54.buffer);
  }
  else{
  v380=v8.getBuffer(v54.buffer);
  }
  v383="type" in v54?v49[v54.type]:v380.dtype;
  v382=!!v54.normalized;
  v381=v54.size|0;
  v384=v54.offset|0;
  v385=v54.stride|0;
  v386=v54.divisor|0;
  }
  }
  v387=g141.location;
  v388=v10[v387];
  if(v375===1){
  if(!v388.buffer){
  v1.enableVertexAttribArray(v387);
  }
  v389=v381||2;
  if(v388.type!==v383||v388.size!==v389||v388.buffer!==v380||v388.normalized!==v382||v388.offset!==v384||v388.stride!==v385){
  v1.bindBuffer(34962,v380.buffer);
  v1.vertexAttribPointer(v387,v389,v383,v382,v385,v384);
  v388.type=v383;
  v388.size=v389;
  v388.buffer=v380;
  v388.normalized=v382;
  v388.offset=v384;
  v388.stride=v385;
  }
  if(v388.divisor!==v386){
  v341.vertexAttribDivisorANGLE(v387,v386);
  v388.divisor=v386;
  }
  }
  else{
  if(v388.buffer){
  v1.disableVertexAttribArray(v387);
  v388.buffer=null;
  }
  if(v388.x!==v376||v388.y!==v377||v388.z!==v378||v388.w!==v379){
  v1.vertexAttrib4f(v387,v376,v377,v378,v379);
  v388.x=v376;
  v388.y=v377;
  v388.z=v378;
  v388.w=v379;
  }
  }
  v390=v343["fill"];
  if(!(v17(v390)&&v390.length===4))g18.commandRaise(g147,g19);
  v391=v390[0];
  v393=v390[1];
  v395=v390[2];
  v397=v390[3];
  if(!v342||v392!==v391||v394!==v393||v396!==v395||v398!==v397){
  v392=v391;
  v394=v393;
  v396=v395;
  v398=v397;
  v1.uniform4f(g145.location,v391,v393,v395,v397);
  }
  v399=v343["id"];
  if(!(typeof v399==="number"))g18.commandRaise(g154,g19);
  if(!v342||v400!==v399){
  v400=v399;
  v1.uniform1f(g152.location,v399);
  }
  v401=v343["opacity"];
  if(!(typeof v401==="number"))g18.commandRaise(g157,g19);
  if(!v342||v402!==v401){
  v402=v401;
  v1.uniform1f(g155.location,v401);
  }
  v403=v343["scale"];
  if(!(v17(v403)&&v403.length===2))g18.commandRaise(g160,g19);
  v404=v403[0];
  v406=v403[1];
  if(!v342||v405!==v404||v407!==v406){
  v405=v404;
  v407=v406;
  v1.uniform2f(g158.location,v404,v406);
  }
  v408=v343["scaleFract"];
  if(!(v17(v408)&&v408.length===2))g18.commandRaise(g165,g19);
  v409=v408[0];
  v411=v408[1];
  if(!v342||v410!==v409||v412!==v411){
  v410=v409;
  v412=v411;
  v1.uniform2f(g163.location,v409,v411);
  }
  v413=v343["translate"];
  if(!(v17(v413)&&v413.length===2))g18.commandRaise(g170,g19);
  v414=v413[0];
  v416=v413[1];
  if(!v342||v415!==v414||v417!==v416){
  v415=v414;
  v417=v416;
  v1.uniform2f(g168.location,v414,v416);
  }
  v418=v343["translateFract"];
  if(!(v17(v418)&&v418.length===2))g18.commandRaise(g175,g19);
  v419=v418[0];
  v421=v418[1];
  if(!v342||v420!==v419||v422!==v421){
  v420=v419;
  v422=v421;
  v1.uniform2f(g173.location,v419,v421);
  }
  v423=g178.call(this,v2,v343,v342);
  v424=null;
  v425=v16(v423);
  if(v425){
  v424=v7.createStream(v423);
  }
  else{
  v424=v7.getElements(v423);
  if(!(!v423||v424))g18.commandRaise(g182,g19);
  }
  if(v424)v1.bindBuffer(34963,v424.buffer.buffer);
  v426=v424?v424.vertCount:-1;
  if(!(v426>=0))g18.commandRaise(g184,g19);
  if(v426){
  if(v427>0){
  if(v424){
  v341.drawElementsInstancedANGLE(4,v426,v424.type,0<<((v424.type-5121)>>1),v427);
  }
  else{
  v341.drawArraysInstancedANGLE(4,0,v426,v427);
  }
  }
  else if(v427<0){
  if(v424){
  v1.drawElements(4,v426,v424.type,0<<((v424.type-5121)>>1));
  }
  else{
  v1.drawArrays(4,0,v426);
  }
  }
  v2.viewportWidth=v349;
  v2.viewportHeight=v350;
  if(v357){
  v8.destroyStream(v363);
  }
  if(v374){
  v8.destroyStream(v380);
  }
  if(v425){
  v7.destroyStream(v424);
  }
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v339){
  g52.cpuTime+=performance.now()-v340;
  }
  }
  ,}
  
  },
  "72858.327": function (_gs, g0, g18, g19, g52, g90, g98, g105, g107, g109, g123, g127, g129, g143, g147, g149, g163, g167, g169, g183, g187, g189, g203, g207, g209, g223, g227, g229, g243, g247, g249, g263, g267, g269, g283, g287, g288, g290, g292, g294, g295, g296, g298, g301, g302, g303, g305, g306, g308, g311, g313, g316, g318, g321, g323, g329, g331, g333, g379, g411, g438, g465, g492, g519, g546, g573, g600, g627) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  return {
  "draw":function(a0){
  var v53,v54,v89,v91,v92,v93,v94,v95,v96,v97,v99,v100,v101,v102,v103,v104,v106,v108,v110,v111,v112,v113,v114,v115,v116,v117,v118,v119,v120,v121,v122,v124,v125,v126,v128,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,v142,v144,v145,v146,v148,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v164,v165,v166,v168,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v184,v185,v186,v188,v190,v191,v192,v193,v194,v195,v196,v197,v198,v199,v200,v201,v202,v204,v205,v206,v208,v210,v211,v212,v213,v214,v215,v216,v217,v218,v219,v220,v221,v222,v224,v225,v226,v228,v230,v231,v232,v233,v234,v235,v236,v237,v238,v239,v240,v241,v242,v244,v245,v246,v248,v250,v251,v252,v253,v254,v255,v256,v257,v258,v259,v260,v261,v262,v264,v265,v266,v268,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v284,v285,v286,v289,v291,v293,v297,v299,v300,v304,v307,v309,v310,v312,v314,v315,v317,v319,v320,v322,v324,v325,v326,v327,v328,v330,v332,v334;
  v53=v14.angle_instanced_arrays;
  v54=v13.next;
  if(v54!==v13.cur){
  if(v54){
  v1.bindFramebuffer(36160,v54.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v54;
  }
  if(v5.dirty){
  var v55,v56,v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88;
  v55=v4.dither;
  if(v55!==v5.dither){
  if(v55){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v55;
  }
  v56=v22[0];
  v57=v22[1];
  if(v56!==v23[0]||v57!==v23[1]){
  v1.blendEquationSeparate(v56,v57);
  v23[0]=v56;
  v23[1]=v57;
  }
  v58=v4.depth_func;
  if(v58!==v5.depth_func){
  v1.depthFunc(v58);
  v5.depth_func=v58;
  }
  v59=v26[0];
  v60=v26[1];
  if(v59!==v27[0]||v60!==v27[1]){
  v1.depthRange(v59,v60);
  v27[0]=v59;
  v27[1]=v60;
  }
  v61=v4.depth_mask;
  if(v61!==v5.depth_mask){
  v1.depthMask(v61);
  v5.depth_mask=v61;
  }
  v62=v28[0];
  v63=v28[1];
  v64=v28[2];
  v65=v28[3];
  if(v62!==v29[0]||v63!==v29[1]||v64!==v29[2]||v65!==v29[3]){
  v1.colorMask(v62,v63,v64,v65);
  v29[0]=v62;
  v29[1]=v63;
  v29[2]=v64;
  v29[3]=v65;
  }
  v66=v4.cull_enable;
  if(v66!==v5.cull_enable){
  if(v66){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v66;
  }
  v67=v4.cull_face;
  if(v67!==v5.cull_face){
  v1.cullFace(v67);
  v5.cull_face=v67;
  }
  v68=v4.frontFace;
  if(v68!==v5.frontFace){
  v1.frontFace(v68);
  v5.frontFace=v68;
  }
  v69=v4.lineWidth;
  if(v69!==v5.lineWidth){
  v1.lineWidth(v69);
  v5.lineWidth=v69;
  }
  v70=v4.polygonOffset_enable;
  if(v70!==v5.polygonOffset_enable){
  if(v70){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v70;
  }
  v71=v30[0];
  v72=v30[1];
  if(v71!==v31[0]||v72!==v31[1]){
  v1.polygonOffset(v71,v72);
  v31[0]=v71;
  v31[1]=v72;
  }
  v73=v4.sample_alpha;
  if(v73!==v5.sample_alpha){
  if(v73){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v73;
  }
  v74=v4.sample_enable;
  if(v74!==v5.sample_enable){
  if(v74){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v74;
  }
  v75=v32[0];
  v76=v32[1];
  if(v75!==v33[0]||v76!==v33[1]){
  v1.sampleCoverage(v75,v76);
  v33[0]=v75;
  v33[1]=v76;
  }
  v77=v4.stencil_mask;
  if(v77!==v5.stencil_mask){
  v1.stencilMask(v77);
  v5.stencil_mask=v77;
  }
  v78=v34[0];
  v79=v34[1];
  v80=v34[2];
  if(v78!==v35[0]||v79!==v35[1]||v80!==v35[2]){
  v1.stencilFunc(v78,v79,v80);
  v35[0]=v78;
  v35[1]=v79;
  v35[2]=v80;
  }
  v81=v36[0];
  v82=v36[1];
  v83=v36[2];
  v84=v36[3];
  if(v81!==v37[0]||v82!==v37[1]||v83!==v37[2]||v84!==v37[3]){
  v1.stencilOpSeparate(v81,v82,v83,v84);
  v37[0]=v81;
  v37[1]=v82;
  v37[2]=v83;
  v37[3]=v84;
  }
  v85=v38[0];
  v86=v38[1];
  v87=v38[2];
  v88=v38[3];
  if(v85!==v39[0]||v86!==v39[1]||v87!==v39[2]||v88!==v39[3]){
  v1.stencilOpSeparate(v85,v86,v87,v88);
  v39[0]=v85;
  v39[1]=v86;
  v39[2]=v87;
  v39[3]=v88;
  }
  }
  v89=a0["viewport"];
  if(!(v89&&typeof v89==="object"))g18.commandRaise(g90,g19);
  v91=v89.x|0;
  v92=v89.y|0;
  v93="width" in v89?v89.width|0:(v2.framebufferWidth-v91);
  v94="height" in v89?v89.height|0:(v2.framebufferHeight-v92);
  if(!(v93>=0&&v94>=0))g18.commandRaise(g90,g19);
  v95=v2.viewportWidth;
  v2.viewportWidth=v93;
  v96=v2.viewportHeight;
  v2.viewportHeight=v94;
  v1.viewport(v91,v92,v93,v94);
  v43[0]=v91;
  v43[1]=v92;
  v43[2]=v93;
  v43[3]=v94;
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[3];
  v97=a0["viewport"];
  if(!(v97&&typeof v97==="object"))g18.commandRaise(g98,g19);
  v99=v97.x|0;
  v100=v97.y|0;
  v101="width" in v97?v97.width|0:(v2.framebufferWidth-v99);
  v102="height" in v97?v97.height|0:(v2.framebufferHeight-v100);
  if(!(v101>=0&&v102>=0))g18.commandRaise(g98,g19);
  v1.scissor(v99,v100,v101,v102);
  v41[0]=v99;
  v41[1]=v100;
  v41[2]=v101;
  v41[3]=v102;
  if(_gs[4]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[5];
  if(_gs[6]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[7];
  v103=v5.profile;
  if(v103){
  v104=performance.now();
  g52.count++;
  }
  v1.useProgram(g105.program);
  v106=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v108=g107.call(this,v2,a0,0);
  if(!(v108&&(typeof v108==="object"||typeof v108==="function")&&(v16(v108)||v8.getBuffer(v108)||v8.getBuffer(v108.buffer)||v16(v108.buffer)||("constant" in v108&&(typeof v108.constant==="number"||v17(v108.constant))))))g18.commandRaise(g109,g19);
  v110=false;
  v111=1;
  v112=0;
  v113=0;
  v114=0;
  v115=0;
  v116=null;
  v117=0;
  v118=false;
  v119=5126;
  v120=0;
  v121=0;
  v122=0;
  if(v16(v108)){
  v110=true;
  v116=v8.createStream(34962,v108);
  v119=v116.dtype;
  }
  else{
  v116=v8.getBuffer(v108);
  if(v116){
  v119=v116.dtype;
  }
  else if("constant" in v108){
  v111=2;
  if(typeof v108.constant === "number"){
  v112=v108.constant;
  v113=v114=v115=0;
  }
  else{
  v112=v108.constant.length>0?v108.constant[0]:0;
  v113=v108.constant.length>1?v108.constant[1]:0;
  v114=v108.constant.length>2?v108.constant[2]:0;
  v115=v108.constant.length>3?v108.constant[3]:0;
  }
  }
  else{
  if(v16(v108.buffer)){
  v116=v8.createStream(34962,v108.buffer);
  }
  else{
  v116=v8.getBuffer(v108.buffer);
  }
  v119="type" in v108?v49[v108.type]:v116.dtype;
  v118=!!v108.normalized;
  v117=v108.size|0;
  v120=v108.offset|0;
  v121=v108.stride|0;
  v122=v108.divisor|0;
  }
  }
  v124=g123.location;
  v125=v10[v124];
  if(v111===1){
  if(!v125.buffer){
  v1.enableVertexAttribArray(v124);
  }
  v126=v117||4;
  if(v125.type!==v119||v125.size!==v126||v125.buffer!==v116||v125.normalized!==v118||v125.offset!==v120||v125.stride!==v121){
  v1.bindBuffer(34962,v116.buffer);
  v1.vertexAttribPointer(v124,v126,v119,v118,v121,v120);
  v125.type=v119;
  v125.size=v126;
  v125.buffer=v116;
  v125.normalized=v118;
  v125.offset=v120;
  v125.stride=v121;
  }
  if(v125.divisor!==v122){
  v106.vertexAttribDivisorANGLE(v124,v122);
  v125.divisor=v122;
  }
  }
  else{
  if(v125.buffer){
  v1.disableVertexAttribArray(v124);
  v125.buffer=null;
  }
  if(v125.x!==v112||v125.y!==v113||v125.z!==v114||v125.w!==v115){
  v1.vertexAttrib4f(v124,v112,v113,v114,v115);
  v125.x=v112;
  v125.y=v113;
  v125.z=v114;
  v125.w=v115;
  }
  }
  v128=g127.call(this,v2,a0,0);
  if(!(v128&&(typeof v128==="object"||typeof v128==="function")&&(v16(v128)||v8.getBuffer(v128)||v8.getBuffer(v128.buffer)||v16(v128.buffer)||("constant" in v128&&(typeof v128.constant==="number"||v17(v128.constant))))))g18.commandRaise(g129,g19);
  v130=false;
  v131=1;
  v132=0;
  v133=0;
  v134=0;
  v135=0;
  v136=null;
  v137=0;
  v138=false;
  v139=5126;
  v140=0;
  v141=0;
  v142=0;
  if(v16(v128)){
  v130=true;
  v136=v8.createStream(34962,v128);
  v139=v136.dtype;
  }
  else{
  v136=v8.getBuffer(v128);
  if(v136){
  v139=v136.dtype;
  }
  else if("constant" in v128){
  v131=2;
  if(typeof v128.constant === "number"){
  v132=v128.constant;
  v133=v134=v135=0;
  }
  else{
  v132=v128.constant.length>0?v128.constant[0]:0;
  v133=v128.constant.length>1?v128.constant[1]:0;
  v134=v128.constant.length>2?v128.constant[2]:0;
  v135=v128.constant.length>3?v128.constant[3]:0;
  }
  }
  else{
  if(v16(v128.buffer)){
  v136=v8.createStream(34962,v128.buffer);
  }
  else{
  v136=v8.getBuffer(v128.buffer);
  }
  v139="type" in v128?v49[v128.type]:v136.dtype;
  v138=!!v128.normalized;
  v137=v128.size|0;
  v140=v128.offset|0;
  v141=v128.stride|0;
  v142=v128.divisor|0;
  }
  }
  v144=g143.location;
  v145=v10[v144];
  if(v131===1){
  if(!v145.buffer){
  v1.enableVertexAttribArray(v144);
  }
  v146=v137||1;
  if(v145.type!==v139||v145.size!==v146||v145.buffer!==v136||v145.normalized!==v138||v145.offset!==v140||v145.stride!==v141){
  v1.bindBuffer(34962,v136.buffer);
  v1.vertexAttribPointer(v144,v146,v139,v138,v141,v140);
  v145.type=v139;
  v145.size=v146;
  v145.buffer=v136;
  v145.normalized=v138;
  v145.offset=v140;
  v145.stride=v141;
  }
  if(v145.divisor!==v142){
  v106.vertexAttribDivisorANGLE(v144,v142);
  v145.divisor=v142;
  }
  }
  else{
  if(v145.buffer){
  v1.disableVertexAttribArray(v144);
  v145.buffer=null;
  }
  if(v145.x!==v132||v145.y!==v133||v145.z!==v134||v145.w!==v135){
  v1.vertexAttrib4f(v144,v132,v133,v134,v135);
  v145.x=v132;
  v145.y=v133;
  v145.z=v134;
  v145.w=v135;
  }
  }
  v148=g147.call(this,v2,a0,0);
  if(!(v148&&(typeof v148==="object"||typeof v148==="function")&&(v16(v148)||v8.getBuffer(v148)||v8.getBuffer(v148.buffer)||v16(v148.buffer)||("constant" in v148&&(typeof v148.constant==="number"||v17(v148.constant))))))g18.commandRaise(g149,g19);
  v150=false;
  v151=1;
  v152=0;
  v153=0;
  v154=0;
  v155=0;
  v156=null;
  v157=0;
  v158=false;
  v159=5126;
  v160=0;
  v161=0;
  v162=0;
  if(v16(v148)){
  v150=true;
  v156=v8.createStream(34962,v148);
  v159=v156.dtype;
  }
  else{
  v156=v8.getBuffer(v148);
  if(v156){
  v159=v156.dtype;
  }
  else if("constant" in v148){
  v151=2;
  if(typeof v148.constant === "number"){
  v152=v148.constant;
  v153=v154=v155=0;
  }
  else{
  v152=v148.constant.length>0?v148.constant[0]:0;
  v153=v148.constant.length>1?v148.constant[1]:0;
  v154=v148.constant.length>2?v148.constant[2]:0;
  v155=v148.constant.length>3?v148.constant[3]:0;
  }
  }
  else{
  if(v16(v148.buffer)){
  v156=v8.createStream(34962,v148.buffer);
  }
  else{
  v156=v8.getBuffer(v148.buffer);
  }
  v159="type" in v148?v49[v148.type]:v156.dtype;
  v158=!!v148.normalized;
  v157=v148.size|0;
  v160=v148.offset|0;
  v161=v148.stride|0;
  v162=v148.divisor|0;
  }
  }
  v164=g163.location;
  v165=v10[v164];
  if(v151===1){
  if(!v165.buffer){
  v1.enableVertexAttribArray(v164);
  }
  v166=v157||4;
  if(v165.type!==v159||v165.size!==v166||v165.buffer!==v156||v165.normalized!==v158||v165.offset!==v160||v165.stride!==v161){
  v1.bindBuffer(34962,v156.buffer);
  v1.vertexAttribPointer(v164,v166,v159,v158,v161,v160);
  v165.type=v159;
  v165.size=v166;
  v165.buffer=v156;
  v165.normalized=v158;
  v165.offset=v160;
  v165.stride=v161;
  }
  if(v165.divisor!==v162){
  v106.vertexAttribDivisorANGLE(v164,v162);
  v165.divisor=v162;
  }
  }
  else{
  if(v165.buffer){
  v1.disableVertexAttribArray(v164);
  v165.buffer=null;
  }
  if(v165.x!==v152||v165.y!==v153||v165.z!==v154||v165.w!==v155){
  v1.vertexAttrib4f(v164,v152,v153,v154,v155);
  v165.x=v152;
  v165.y=v153;
  v165.z=v154;
  v165.w=v155;
  }
  }
  v168=g167.call(this,v2,a0,0);
  if(!(v168&&(typeof v168==="object"||typeof v168==="function")&&(v16(v168)||v8.getBuffer(v168)||v8.getBuffer(v168.buffer)||v16(v168.buffer)||("constant" in v168&&(typeof v168.constant==="number"||v17(v168.constant))))))g18.commandRaise(g169,g19);
  v170=false;
  v171=1;
  v172=0;
  v173=0;
  v174=0;
  v175=0;
  v176=null;
  v177=0;
  v178=false;
  v179=5126;
  v180=0;
  v181=0;
  v182=0;
  if(v16(v168)){
  v170=true;
  v176=v8.createStream(34962,v168);
  v179=v176.dtype;
  }
  else{
  v176=v8.getBuffer(v168);
  if(v176){
  v179=v176.dtype;
  }
  else if("constant" in v168){
  v171=2;
  if(typeof v168.constant === "number"){
  v172=v168.constant;
  v173=v174=v175=0;
  }
  else{
  v172=v168.constant.length>0?v168.constant[0]:0;
  v173=v168.constant.length>1?v168.constant[1]:0;
  v174=v168.constant.length>2?v168.constant[2]:0;
  v175=v168.constant.length>3?v168.constant[3]:0;
  }
  }
  else{
  if(v16(v168.buffer)){
  v176=v8.createStream(34962,v168.buffer);
  }
  else{
  v176=v8.getBuffer(v168.buffer);
  }
  v179="type" in v168?v49[v168.type]:v176.dtype;
  v178=!!v168.normalized;
  v177=v168.size|0;
  v180=v168.offset|0;
  v181=v168.stride|0;
  v182=v168.divisor|0;
  }
  }
  v184=g183.location;
  v185=v10[v184];
  if(v171===1){
  if(!v185.buffer){
  v1.enableVertexAttribArray(v184);
  }
  v186=v177||1;
  if(v185.type!==v179||v185.size!==v186||v185.buffer!==v176||v185.normalized!==v178||v185.offset!==v180||v185.stride!==v181){
  v1.bindBuffer(34962,v176.buffer);
  v1.vertexAttribPointer(v184,v186,v179,v178,v181,v180);
  v185.type=v179;
  v185.size=v186;
  v185.buffer=v176;
  v185.normalized=v178;
  v185.offset=v180;
  v185.stride=v181;
  }
  if(v185.divisor!==v182){
  v106.vertexAttribDivisorANGLE(v184,v182);
  v185.divisor=v182;
  }
  }
  else{
  if(v185.buffer){
  v1.disableVertexAttribArray(v184);
  v185.buffer=null;
  }
  if(v185.x!==v172||v185.y!==v173||v185.z!==v174||v185.w!==v175){
  v1.vertexAttrib4f(v184,v172,v173,v174,v175);
  v185.x=v172;
  v185.y=v173;
  v185.z=v174;
  v185.w=v175;
  }
  }
  v188=g187.call(this,v2,a0,0);
  if(!(v188&&(typeof v188==="object"||typeof v188==="function")&&(v16(v188)||v8.getBuffer(v188)||v8.getBuffer(v188.buffer)||v16(v188.buffer)||("constant" in v188&&(typeof v188.constant==="number"||v17(v188.constant))))))g18.commandRaise(g189,g19);
  v190=false;
  v191=1;
  v192=0;
  v193=0;
  v194=0;
  v195=0;
  v196=null;
  v197=0;
  v198=false;
  v199=5126;
  v200=0;
  v201=0;
  v202=0;
  if(v16(v188)){
  v190=true;
  v196=v8.createStream(34962,v188);
  v199=v196.dtype;
  }
  else{
  v196=v8.getBuffer(v188);
  if(v196){
  v199=v196.dtype;
  }
  else if("constant" in v188){
  v191=2;
  if(typeof v188.constant === "number"){
  v192=v188.constant;
  v193=v194=v195=0;
  }
  else{
  v192=v188.constant.length>0?v188.constant[0]:0;
  v193=v188.constant.length>1?v188.constant[1]:0;
  v194=v188.constant.length>2?v188.constant[2]:0;
  v195=v188.constant.length>3?v188.constant[3]:0;
  }
  }
  else{
  if(v16(v188.buffer)){
  v196=v8.createStream(34962,v188.buffer);
  }
  else{
  v196=v8.getBuffer(v188.buffer);
  }
  v199="type" in v188?v49[v188.type]:v196.dtype;
  v198=!!v188.normalized;
  v197=v188.size|0;
  v200=v188.offset|0;
  v201=v188.stride|0;
  v202=v188.divisor|0;
  }
  }
  v204=g203.location;
  v205=v10[v204];
  if(v191===1){
  if(!v205.buffer){
  v1.enableVertexAttribArray(v204);
  }
  v206=v197||1;
  if(v205.type!==v199||v205.size!==v206||v205.buffer!==v196||v205.normalized!==v198||v205.offset!==v200||v205.stride!==v201){
  v1.bindBuffer(34962,v196.buffer);
  v1.vertexAttribPointer(v204,v206,v199,v198,v201,v200);
  v205.type=v199;
  v205.size=v206;
  v205.buffer=v196;
  v205.normalized=v198;
  v205.offset=v200;
  v205.stride=v201;
  }
  if(v205.divisor!==v202){
  v106.vertexAttribDivisorANGLE(v204,v202);
  v205.divisor=v202;
  }
  }
  else{
  if(v205.buffer){
  v1.disableVertexAttribArray(v204);
  v205.buffer=null;
  }
  if(v205.x!==v192||v205.y!==v193||v205.z!==v194||v205.w!==v195){
  v1.vertexAttrib4f(v204,v192,v193,v194,v195);
  v205.x=v192;
  v205.y=v193;
  v205.z=v194;
  v205.w=v195;
  }
  }
  v208=g207.call(this,v2,a0,0);
  if(!(v208&&(typeof v208==="object"||typeof v208==="function")&&(v16(v208)||v8.getBuffer(v208)||v8.getBuffer(v208.buffer)||v16(v208.buffer)||("constant" in v208&&(typeof v208.constant==="number"||v17(v208.constant))))))g18.commandRaise(g209,g19);
  v210=false;
  v211=1;
  v212=0;
  v213=0;
  v214=0;
  v215=0;
  v216=null;
  v217=0;
  v218=false;
  v219=5126;
  v220=0;
  v221=0;
  v222=0;
  if(v16(v208)){
  v210=true;
  v216=v8.createStream(34962,v208);
  v219=v216.dtype;
  }
  else{
  v216=v8.getBuffer(v208);
  if(v216){
  v219=v216.dtype;
  }
  else if("constant" in v208){
  v211=2;
  if(typeof v208.constant === "number"){
  v212=v208.constant;
  v213=v214=v215=0;
  }
  else{
  v212=v208.constant.length>0?v208.constant[0]:0;
  v213=v208.constant.length>1?v208.constant[1]:0;
  v214=v208.constant.length>2?v208.constant[2]:0;
  v215=v208.constant.length>3?v208.constant[3]:0;
  }
  }
  else{
  if(v16(v208.buffer)){
  v216=v8.createStream(34962,v208.buffer);
  }
  else{
  v216=v8.getBuffer(v208.buffer);
  }
  v219="type" in v208?v49[v208.type]:v216.dtype;
  v218=!!v208.normalized;
  v217=v208.size|0;
  v220=v208.offset|0;
  v221=v208.stride|0;
  v222=v208.divisor|0;
  }
  }
  v224=g223.location;
  v225=v10[v224];
  if(v211===1){
  if(!v225.buffer){
  v1.enableVertexAttribArray(v224);
  }
  v226=v217||1;
  if(v225.type!==v219||v225.size!==v226||v225.buffer!==v216||v225.normalized!==v218||v225.offset!==v220||v225.stride!==v221){
  v1.bindBuffer(34962,v216.buffer);
  v1.vertexAttribPointer(v224,v226,v219,v218,v221,v220);
  v225.type=v219;
  v225.size=v226;
  v225.buffer=v216;
  v225.normalized=v218;
  v225.offset=v220;
  v225.stride=v221;
  }
  if(v225.divisor!==v222){
  v106.vertexAttribDivisorANGLE(v224,v222);
  v225.divisor=v222;
  }
  }
  else{
  if(v225.buffer){
  v1.disableVertexAttribArray(v224);
  v225.buffer=null;
  }
  if(v225.x!==v212||v225.y!==v213||v225.z!==v214||v225.w!==v215){
  v1.vertexAttrib4f(v224,v212,v213,v214,v215);
  v225.x=v212;
  v225.y=v213;
  v225.z=v214;
  v225.w=v215;
  }
  }
  v228=g227.call(this,v2,a0,0);
  if(!(v228&&(typeof v228==="object"||typeof v228==="function")&&(v16(v228)||v8.getBuffer(v228)||v8.getBuffer(v228.buffer)||v16(v228.buffer)||("constant" in v228&&(typeof v228.constant==="number"||v17(v228.constant))))))g18.commandRaise(g229,g19);
  v230=false;
  v231=1;
  v232=0;
  v233=0;
  v234=0;
  v235=0;
  v236=null;
  v237=0;
  v238=false;
  v239=5126;
  v240=0;
  v241=0;
  v242=0;
  if(v16(v228)){
  v230=true;
  v236=v8.createStream(34962,v228);
  v239=v236.dtype;
  }
  else{
  v236=v8.getBuffer(v228);
  if(v236){
  v239=v236.dtype;
  }
  else if("constant" in v228){
  v231=2;
  if(typeof v228.constant === "number"){
  v232=v228.constant;
  v233=v234=v235=0;
  }
  else{
  v232=v228.constant.length>0?v228.constant[0]:0;
  v233=v228.constant.length>1?v228.constant[1]:0;
  v234=v228.constant.length>2?v228.constant[2]:0;
  v235=v228.constant.length>3?v228.constant[3]:0;
  }
  }
  else{
  if(v16(v228.buffer)){
  v236=v8.createStream(34962,v228.buffer);
  }
  else{
  v236=v8.getBuffer(v228.buffer);
  }
  v239="type" in v228?v49[v228.type]:v236.dtype;
  v238=!!v228.normalized;
  v237=v228.size|0;
  v240=v228.offset|0;
  v241=v228.stride|0;
  v242=v228.divisor|0;
  }
  }
  v244=g243.location;
  v245=v10[v244];
  if(v231===1){
  if(!v245.buffer){
  v1.enableVertexAttribArray(v244);
  }
  v246=v237||1;
  if(v245.type!==v239||v245.size!==v246||v245.buffer!==v236||v245.normalized!==v238||v245.offset!==v240||v245.stride!==v241){
  v1.bindBuffer(34962,v236.buffer);
  v1.vertexAttribPointer(v244,v246,v239,v238,v241,v240);
  v245.type=v239;
  v245.size=v246;
  v245.buffer=v236;
  v245.normalized=v238;
  v245.offset=v240;
  v245.stride=v241;
  }
  if(v245.divisor!==v242){
  v106.vertexAttribDivisorANGLE(v244,v242);
  v245.divisor=v242;
  }
  }
  else{
  if(v245.buffer){
  v1.disableVertexAttribArray(v244);
  v245.buffer=null;
  }
  if(v245.x!==v232||v245.y!==v233||v245.z!==v234||v245.w!==v235){
  v1.vertexAttrib4f(v244,v232,v233,v234,v235);
  v245.x=v232;
  v245.y=v233;
  v245.z=v234;
  v245.w=v235;
  }
  }
  v248=g247.call(this,v2,a0,0);
  if(!(v248&&(typeof v248==="object"||typeof v248==="function")&&(v16(v248)||v8.getBuffer(v248)||v8.getBuffer(v248.buffer)||v16(v248.buffer)||("constant" in v248&&(typeof v248.constant==="number"||v17(v248.constant))))))g18.commandRaise(g249,g19);
  v250=false;
  v251=1;
  v252=0;
  v253=0;
  v254=0;
  v255=0;
  v256=null;
  v257=0;
  v258=false;
  v259=5126;
  v260=0;
  v261=0;
  v262=0;
  if(v16(v248)){
  v250=true;
  v256=v8.createStream(34962,v248);
  v259=v256.dtype;
  }
  else{
  v256=v8.getBuffer(v248);
  if(v256){
  v259=v256.dtype;
  }
  else if("constant" in v248){
  v251=2;
  if(typeof v248.constant === "number"){
  v252=v248.constant;
  v253=v254=v255=0;
  }
  else{
  v252=v248.constant.length>0?v248.constant[0]:0;
  v253=v248.constant.length>1?v248.constant[1]:0;
  v254=v248.constant.length>2?v248.constant[2]:0;
  v255=v248.constant.length>3?v248.constant[3]:0;
  }
  }
  else{
  if(v16(v248.buffer)){
  v256=v8.createStream(34962,v248.buffer);
  }
  else{
  v256=v8.getBuffer(v248.buffer);
  }
  v259="type" in v248?v49[v248.type]:v256.dtype;
  v258=!!v248.normalized;
  v257=v248.size|0;
  v260=v248.offset|0;
  v261=v248.stride|0;
  v262=v248.divisor|0;
  }
  }
  v264=g263.location;
  v265=v10[v264];
  if(v251===1){
  if(!v265.buffer){
  v1.enableVertexAttribArray(v264);
  }
  v266=v257||1;
  if(v265.type!==v259||v265.size!==v266||v265.buffer!==v256||v265.normalized!==v258||v265.offset!==v260||v265.stride!==v261){
  v1.bindBuffer(34962,v256.buffer);
  v1.vertexAttribPointer(v264,v266,v259,v258,v261,v260);
  v265.type=v259;
  v265.size=v266;
  v265.buffer=v256;
  v265.normalized=v258;
  v265.offset=v260;
  v265.stride=v261;
  }
  if(v265.divisor!==v262){
  v106.vertexAttribDivisorANGLE(v264,v262);
  v265.divisor=v262;
  }
  }
  else{
  if(v265.buffer){
  v1.disableVertexAttribArray(v264);
  v265.buffer=null;
  }
  if(v265.x!==v252||v265.y!==v253||v265.z!==v254||v265.w!==v255){
  v1.vertexAttrib4f(v264,v252,v253,v254,v255);
  v265.x=v252;
  v265.y=v253;
  v265.z=v254;
  v265.w=v255;
  }
  }
  v268=g267.call(this,v2,a0,0);
  if(!(v268&&(typeof v268==="object"||typeof v268==="function")&&(v16(v268)||v8.getBuffer(v268)||v8.getBuffer(v268.buffer)||v16(v268.buffer)||("constant" in v268&&(typeof v268.constant==="number"||v17(v268.constant))))))g18.commandRaise(g269,g19);
  v270=false;
  v271=1;
  v272=0;
  v273=0;
  v274=0;
  v275=0;
  v276=null;
  v277=0;
  v278=false;
  v279=5126;
  v280=0;
  v281=0;
  v282=0;
  if(v16(v268)){
  v270=true;
  v276=v8.createStream(34962,v268);
  v279=v276.dtype;
  }
  else{
  v276=v8.getBuffer(v268);
  if(v276){
  v279=v276.dtype;
  }
  else if("constant" in v268){
  v271=2;
  if(typeof v268.constant === "number"){
  v272=v268.constant;
  v273=v274=v275=0;
  }
  else{
  v272=v268.constant.length>0?v268.constant[0]:0;
  v273=v268.constant.length>1?v268.constant[1]:0;
  v274=v268.constant.length>2?v268.constant[2]:0;
  v275=v268.constant.length>3?v268.constant[3]:0;
  }
  }
  else{
  if(v16(v268.buffer)){
  v276=v8.createStream(34962,v268.buffer);
  }
  else{
  v276=v8.getBuffer(v268.buffer);
  }
  v279="type" in v268?v49[v268.type]:v276.dtype;
  v278=!!v268.normalized;
  v277=v268.size|0;
  v280=v268.offset|0;
  v281=v268.stride|0;
  v282=v268.divisor|0;
  }
  }
  v284=g283.location;
  v285=v10[v284];
  if(v271===1){
  if(!v285.buffer){
  v1.enableVertexAttribArray(v284);
  }
  v286=v277||1;
  if(v285.type!==v279||v285.size!==v286||v285.buffer!==v276||v285.normalized!==v278||v285.offset!==v280||v285.stride!==v281){
  v1.bindBuffer(34962,v276.buffer);
  v1.vertexAttribPointer(v284,v286,v279,v278,v281,v280);
  v285.type=v279;
  v285.size=v286;
  v285.buffer=v276;
  v285.normalized=v278;
  v285.offset=v280;
  v285.stride=v281;
  }
  if(v285.divisor!==v282){
  v106.vertexAttribDivisorANGLE(v284,v282);
  v285.divisor=v282;
  }
  }
  else{
  if(v285.buffer){
  v1.disableVertexAttribArray(v284);
  v285.buffer=null;
  }
  if(v285.x!==v272||v285.y!==v273||v285.z!==v274||v285.w!==v275){
  v1.vertexAttrib4f(v284,v272,v273,v274,v275);
  v285.x=v272;
  v285.y=v273;
  v285.z=v274;
  v285.w=v275;
  }
  }
  v1.uniform1i(g287.location,false);
  v289=a0["markerTexture"];
  if(v289&&v289._reglType==="framebuffer"){
  v289=v289.color[0];
  }
  if(!(typeof v289==="function"&&v289._reglType==="texture2d"))g18.commandRaise(g290,g19);
  v291=v289._texture;
  v1.uniform1i(g288.location,v291.bind());
  v293=a0["opacity"];
  if(!(typeof v293==="number"))g18.commandRaise(g294,g19);
  v1.uniform1f(g292.location,v293);
  v297=g296.call(this,v2,a0,0);
  if(!(v17(v297)&&v297.length===2))g18.commandRaise(g298,g19);
  v299=v297[0];
  v300=v297[1];
  v1.uniform2f(g295.location,v299,v300);
  v1.uniform1i(g301.location,g302.bind());
  v304=v2["pixelRatio"];
  if(!(typeof v304==="number"))g18.commandRaise(g305,g19);
  v1.uniform1f(g303.location,v304);
  v307=a0["scale"];
  if(!(v17(v307)&&v307.length===2))g18.commandRaise(g308,g19);
  v309=v307[0];
  v310=v307[1];
  v1.uniform2f(g306.location,v309,v310);
  v312=a0["scaleFract"];
  if(!(v17(v312)&&v312.length===2))g18.commandRaise(g313,g19);
  v314=v312[0];
  v315=v312[1];
  v1.uniform2f(g311.location,v314,v315);
  v317=a0["translate"];
  if(!(v17(v317)&&v317.length===2))g18.commandRaise(g318,g19);
  v319=v317[0];
  v320=v317[1];
  v1.uniform2f(g316.location,v319,v320);
  v322=a0["translateFract"];
  if(!(v17(v322)&&v322.length===2))g18.commandRaise(g323,g19);
  v324=v322[0];
  v325=v322[1];
  v1.uniform2f(g321.location,v324,v325);
  v326=a0["elements"];
  v327=null;
  v328=v16(v326);
  if(v328){
  v327=v7.createStream(v326);
  }
  else{
  v327=v7.getElements(v326);
  if(!(!v326||v327))g18.commandRaise(g329,g19);
  }
  if(v327)v1.bindBuffer(34963,v327.buffer.buffer);
  v330=a0["offset"];
  if(!(v330>=0))g18.commandRaise(g331,g19);
  v332=a0["count"];
  if(!(typeof v332==="number"&&v332>=0&&v332===(v332|0)))g18.commandRaise(g333,g19);
  if(v332){
  v334=v6.instances;
  if(v334>0){
  if(v327){
  v106.drawElementsInstancedANGLE(0,v332,v327.type,v330<<((v327.type-5121)>>1),v334);
  }
  else{
  v106.drawArraysInstancedANGLE(0,v330,v332,v334);
  }
  }
  else if(v334<0){
  if(v327){
  v1.drawElements(0,v332,v327.type,v330<<((v327.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v330,v332);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v95;
  v2.viewportHeight=v96;
  if(v103){
  g52.cpuTime+=performance.now()-v104;
  }
  if(v110){
  v8.destroyStream(v116);
  }
  if(v130){
  v8.destroyStream(v136);
  }
  if(v150){
  v8.destroyStream(v156);
  }
  if(v170){
  v8.destroyStream(v176);
  }
  if(v190){
  v8.destroyStream(v196);
  }
  if(v210){
  v8.destroyStream(v216);
  }
  if(v230){
  v8.destroyStream(v236);
  }
  if(v250){
  v8.destroyStream(v256);
  }
  if(v270){
  v8.destroyStream(v276);
  }
  v291.unbind();
  g302.unbind();
  if(v328){
  v7.destroyStream(v327);
  }
  }
  }
  ,"scope":function(a0,a1,a2){
  var v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v348,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v375,v376,v377,v378,v380,v381,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v403,v404,v405,v406,v407,v408,v409,v410,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v434,v435,v436,v437,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v449,v450,v451,v452,v453,v454,v455,v456,v457,v458,v459,v460,v461,v462,v463,v464,v466,v467,v468,v469,v470,v471,v472,v473,v474,v475,v476,v477,v478,v479,v480,v481,v482,v483,v484,v485,v486,v487,v488,v489,v490,v491,v493,v494,v495,v496,v497,v498,v499,v500,v501,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v514,v515,v516,v517,v518,v520,v521,v522,v523,v524,v525,v526,v527,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537,v538,v539,v540,v541,v542,v543,v544,v545,v547,v548,v549,v550,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v569,v570,v571,v572,v574,v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v586,v587,v588,v589,v590,v591,v592,v593,v594,v595,v596,v597,v598,v599,v601,v602,v603,v604,v605,v606,v607,v608,v609,v610,v611,v612,v613,v614,v615,v616,v617,v618,v619,v620,v621,v622,v623,v624,v625,v626,v628,v629,v630,v631,v632,v633,v634,v635,v636,v637,v638,v639,v640,v641;
  v335=a0["viewport"];
  if(!(v335&&typeof v335==="object"))g18.commandRaise(g90,g19);
  v336=v335.x|0;
  v337=v335.y|0;
  v338="width" in v335?v335.width|0:(v2.framebufferWidth-v336);
  v339="height" in v335?v335.height|0:(v2.framebufferHeight-v337);
  if(!(v338>=0&&v339>=0))g18.commandRaise(g90,g19);
  v340=v2.viewportWidth;
  v2.viewportWidth=v338;
  v341=v2.viewportHeight;
  v2.viewportHeight=v339;
  v342=v42[0];
  v42[0]=_gs[8];
  v343=v42[1];
  v42[1]=_gs[9];
  v344=v42[2];
  v42[2]=_gs[10];
  v345=v42[3];
  v42[3]=_gs[11];
  v346=v20[0];
  v20[0]=_gs[12];
  v347=v20[1];
  v20[1]=_gs[13];
  v348=v20[2];
  v20[2]=_gs[14];
  v349=v20[3];
  v20[3]=_gs[15];
  v350=v4.blend_enable;
  v4.blend_enable=_gs[16];
  v351=v24[0];
  v24[0]=_gs[17];
  v352=v24[1];
  v24[1]=_gs[18];
  v353=v24[2];
  v24[2]=_gs[19];
  v354=v24[3];
  v24[3]=_gs[20];
  v355=v4.depth_enable;
  v4.depth_enable=_gs[21];
  v356=a0["viewport"];
  if(!(v356&&typeof v356==="object"))g18.commandRaise(g98,g19);
  v357=v356.x|0;
  v358=v356.y|0;
  v359="width" in v356?v356.width|0:(v2.framebufferWidth-v357);
  v360="height" in v356?v356.height|0:(v2.framebufferHeight-v358);
  if(!(v359>=0&&v360>=0))g18.commandRaise(g98,g19);
  v361=v40[0];
  v40[0]=_gs[22];
  v362=v40[1];
  v40[1]=_gs[23];
  v363=v40[2];
  v40[2]=_gs[24];
  v364=v40[3];
  v40[3]=_gs[25];
  v365=v4.scissor_enable;
  v4.scissor_enable=_gs[26];
  v366=v4.stencil_enable;
  v4.stencil_enable=_gs[27];
  v367=v5.profile;
  if(v367){
  v368=performance.now();
  g52.count++;
  }
  v369=a0["elements"];
  v370=null;
  v371=v16(v369);
  if(v371){
  v370=v7.createStream(v369);
  }
  else{
  v370=v7.getElements(v369);
  if(!(!v369||v370))g18.commandRaise(g329,g19);
  }
  v372=v6.elements;
  v6.elements=_gs[28];
  v373=a0["offset"];
  if(!(v373>=0))g18.commandRaise(g331,g19);
  v374=v6.offset;
  v6.offset=_gs[29];
  v375=a0["count"];
  if(!(typeof v375==="number"&&v375>=0&&v375===(v375|0)))g18.commandRaise(g333,g19);
  v376=v6.count;
  v6.count=_gs[30];
  v377=v6.primitive;
  v6.primitive=_gs[31];
  v378=v12[_gs[32]];
  v12[_gs[32]]=false;
  v380=v12[_gs[33]];
  v12[_gs[33]]=g379;
  v381=a0["opacity"];
  v382=v12[_gs[34]];
  v12[_gs[34]]=v381;
  v383=g296.call(this,v2,a0,a2);
  v384=v12[_gs[35]];
  v12[_gs[35]]=v383;
  v385=v2["pixelRatio"];
  v386=v12[_gs[36]];
  v12[_gs[36]]=v385;
  v387=a0["scale"];
  v388=v12[_gs[37]];
  v12[_gs[37]]=v387;
  v389=a0["scaleFract"];
  v390=v12[_gs[38]];
  v12[_gs[38]]=v389;
  v391=a0["translate"];
  v392=v12[_gs[39]];
  v12[_gs[39]]=v391;
  v393=a0["translateFract"];
  v394=v12[_gs[40]];
  v12[_gs[40]]=v393;
  v395=a0["markerTexture"];
  v396=v12[_gs[41]];
  v12[_gs[41]]=v395;
  v397=g207.call(this,v2,a0,a2);
  if(!(v397&&(typeof v397==="object"||typeof v397==="function")&&(v16(v397)||v8.getBuffer(v397)||v8.getBuffer(v397.buffer)||v16(v397.buffer)||("constant" in v397&&(typeof v397.constant==="number"||v17(v397.constant))))))g18.commandRaise(g209,g19);
  v398=false;
  v399=1;
  v400=0;
  v401=0;
  v402=0;
  v403=0;
  v404=null;
  v405=0;
  v406=false;
  v407=5126;
  v408=0;
  v409=0;
  v410=0;
  if(v16(v397)){
  v398=true;
  v404=v8.createStream(34962,v397);
  v407=v404.dtype;
  }
  else{
  v404=v8.getBuffer(v397);
  if(v404){
  v407=v404.dtype;
  }
  else if("constant" in v397){
  v399=2;
  if(typeof v397.constant === "number"){
  v400=v397.constant;
  v401=v402=v403=0;
  }
  else{
  v400=v397.constant.length>0?v397.constant[0]:0;
  v401=v397.constant.length>1?v397.constant[1]:0;
  v402=v397.constant.length>2?v397.constant[2]:0;
  v403=v397.constant.length>3?v397.constant[3]:0;
  }
  }
  else{
  if(v16(v397.buffer)){
  v404=v8.createStream(34962,v397.buffer);
  }
  else{
  v404=v8.getBuffer(v397.buffer);
  }
  v407="type" in v397?v49[v397.type]:v404.dtype;
  v406=!!v397.normalized;
  v405=v397.size|0;
  v408=v397.offset|0;
  v409=v397.stride|0;
  v410=v397.divisor|0;
  }
  }
  v412=g411.state;
  g411.state=v399;
  v413=g411.x;
  g411.x=v400;
  v414=g411.y;
  g411.y=v401;
  v415=g411.z;
  g411.z=v402;
  v416=g411.w;
  g411.w=v403;
  v417=g411.buffer;
  g411.buffer=v404;
  v418=g411.size;
  g411.size=v405;
  v419=g411.normalized;
  g411.normalized=v406;
  v420=g411.type;
  g411.type=v407;
  v421=g411.offset;
  g411.offset=v408;
  v422=g411.stride;
  g411.stride=v409;
  v423=g411.divisor;
  g411.divisor=v410;
  v424=g247.call(this,v2,a0,a2);
  if(!(v424&&(typeof v424==="object"||typeof v424==="function")&&(v16(v424)||v8.getBuffer(v424)||v8.getBuffer(v424.buffer)||v16(v424.buffer)||("constant" in v424&&(typeof v424.constant==="number"||v17(v424.constant))))))g18.commandRaise(g249,g19);
  v425=false;
  v426=1;
  v427=0;
  v428=0;
  v429=0;
  v430=0;
  v431=null;
  v432=0;
  v433=false;
  v434=5126;
  v435=0;
  v436=0;
  v437=0;
  if(v16(v424)){
  v425=true;
  v431=v8.createStream(34962,v424);
  v434=v431.dtype;
  }
  else{
  v431=v8.getBuffer(v424);
  if(v431){
  v434=v431.dtype;
  }
  else if("constant" in v424){
  v426=2;
  if(typeof v424.constant === "number"){
  v427=v424.constant;
  v428=v429=v430=0;
  }
  else{
  v427=v424.constant.length>0?v424.constant[0]:0;
  v428=v424.constant.length>1?v424.constant[1]:0;
  v429=v424.constant.length>2?v424.constant[2]:0;
  v430=v424.constant.length>3?v424.constant[3]:0;
  }
  }
  else{
  if(v16(v424.buffer)){
  v431=v8.createStream(34962,v424.buffer);
  }
  else{
  v431=v8.getBuffer(v424.buffer);
  }
  v434="type" in v424?v49[v424.type]:v431.dtype;
  v433=!!v424.normalized;
  v432=v424.size|0;
  v435=v424.offset|0;
  v436=v424.stride|0;
  v437=v424.divisor|0;
  }
  }
  v439=g438.state;
  g438.state=v426;
  v440=g438.x;
  g438.x=v427;
  v441=g438.y;
  g438.y=v428;
  v442=g438.z;
  g438.z=v429;
  v443=g438.w;
  g438.w=v430;
  v444=g438.buffer;
  g438.buffer=v431;
  v445=g438.size;
  g438.size=v432;
  v446=g438.normalized;
  g438.normalized=v433;
  v447=g438.type;
  g438.type=v434;
  v448=g438.offset;
  g438.offset=v435;
  v449=g438.stride;
  g438.stride=v436;
  v450=g438.divisor;
  g438.divisor=v437;
  v451=g227.call(this,v2,a0,a2);
  if(!(v451&&(typeof v451==="object"||typeof v451==="function")&&(v16(v451)||v8.getBuffer(v451)||v8.getBuffer(v451.buffer)||v16(v451.buffer)||("constant" in v451&&(typeof v451.constant==="number"||v17(v451.constant))))))g18.commandRaise(g229,g19);
  v452=false;
  v453=1;
  v454=0;
  v455=0;
  v456=0;
  v457=0;
  v458=null;
  v459=0;
  v460=false;
  v461=5126;
  v462=0;
  v463=0;
  v464=0;
  if(v16(v451)){
  v452=true;
  v458=v8.createStream(34962,v451);
  v461=v458.dtype;
  }
  else{
  v458=v8.getBuffer(v451);
  if(v458){
  v461=v458.dtype;
  }
  else if("constant" in v451){
  v453=2;
  if(typeof v451.constant === "number"){
  v454=v451.constant;
  v455=v456=v457=0;
  }
  else{
  v454=v451.constant.length>0?v451.constant[0]:0;
  v455=v451.constant.length>1?v451.constant[1]:0;
  v456=v451.constant.length>2?v451.constant[2]:0;
  v457=v451.constant.length>3?v451.constant[3]:0;
  }
  }
  else{
  if(v16(v451.buffer)){
  v458=v8.createStream(34962,v451.buffer);
  }
  else{
  v458=v8.getBuffer(v451.buffer);
  }
  v461="type" in v451?v49[v451.type]:v458.dtype;
  v460=!!v451.normalized;
  v459=v451.size|0;
  v462=v451.offset|0;
  v463=v451.stride|0;
  v464=v451.divisor|0;
  }
  }
  v466=g465.state;
  g465.state=v453;
  v467=g465.x;
  g465.x=v454;
  v468=g465.y;
  g465.y=v455;
  v469=g465.z;
  g465.z=v456;
  v470=g465.w;
  g465.w=v457;
  v471=g465.buffer;
  g465.buffer=v458;
  v472=g465.size;
  g465.size=v459;
  v473=g465.normalized;
  g465.normalized=v460;
  v474=g465.type;
  g465.type=v461;
  v475=g465.offset;
  g465.offset=v462;
  v476=g465.stride;
  g465.stride=v463;
  v477=g465.divisor;
  g465.divisor=v464;
  v478=g267.call(this,v2,a0,a2);
  if(!(v478&&(typeof v478==="object"||typeof v478==="function")&&(v16(v478)||v8.getBuffer(v478)||v8.getBuffer(v478.buffer)||v16(v478.buffer)||("constant" in v478&&(typeof v478.constant==="number"||v17(v478.constant))))))g18.commandRaise(g269,g19);
  v479=false;
  v480=1;
  v481=0;
  v482=0;
  v483=0;
  v484=0;
  v485=null;
  v486=0;
  v487=false;
  v488=5126;
  v489=0;
  v490=0;
  v491=0;
  if(v16(v478)){
  v479=true;
  v485=v8.createStream(34962,v478);
  v488=v485.dtype;
  }
  else{
  v485=v8.getBuffer(v478);
  if(v485){
  v488=v485.dtype;
  }
  else if("constant" in v478){
  v480=2;
  if(typeof v478.constant === "number"){
  v481=v478.constant;
  v482=v483=v484=0;
  }
  else{
  v481=v478.constant.length>0?v478.constant[0]:0;
  v482=v478.constant.length>1?v478.constant[1]:0;
  v483=v478.constant.length>2?v478.constant[2]:0;
  v484=v478.constant.length>3?v478.constant[3]:0;
  }
  }
  else{
  if(v16(v478.buffer)){
  v485=v8.createStream(34962,v478.buffer);
  }
  else{
  v485=v8.getBuffer(v478.buffer);
  }
  v488="type" in v478?v49[v478.type]:v485.dtype;
  v487=!!v478.normalized;
  v486=v478.size|0;
  v489=v478.offset|0;
  v490=v478.stride|0;
  v491=v478.divisor|0;
  }
  }
  v493=g492.state;
  g492.state=v480;
  v494=g492.x;
  g492.x=v481;
  v495=g492.y;
  g492.y=v482;
  v496=g492.z;
  g492.z=v483;
  v497=g492.w;
  g492.w=v484;
  v498=g492.buffer;
  g492.buffer=v485;
  v499=g492.size;
  g492.size=v486;
  v500=g492.normalized;
  g492.normalized=v487;
  v501=g492.type;
  g492.type=v488;
  v502=g492.offset;
  g492.offset=v489;
  v503=g492.stride;
  g492.stride=v490;
  v504=g492.divisor;
  g492.divisor=v491;
  v505=g187.call(this,v2,a0,a2);
  if(!(v505&&(typeof v505==="object"||typeof v505==="function")&&(v16(v505)||v8.getBuffer(v505)||v8.getBuffer(v505.buffer)||v16(v505.buffer)||("constant" in v505&&(typeof v505.constant==="number"||v17(v505.constant))))))g18.commandRaise(g189,g19);
  v506=false;
  v507=1;
  v508=0;
  v509=0;
  v510=0;
  v511=0;
  v512=null;
  v513=0;
  v514=false;
  v515=5126;
  v516=0;
  v517=0;
  v518=0;
  if(v16(v505)){
  v506=true;
  v512=v8.createStream(34962,v505);
  v515=v512.dtype;
  }
  else{
  v512=v8.getBuffer(v505);
  if(v512){
  v515=v512.dtype;
  }
  else if("constant" in v505){
  v507=2;
  if(typeof v505.constant === "number"){
  v508=v505.constant;
  v509=v510=v511=0;
  }
  else{
  v508=v505.constant.length>0?v505.constant[0]:0;
  v509=v505.constant.length>1?v505.constant[1]:0;
  v510=v505.constant.length>2?v505.constant[2]:0;
  v511=v505.constant.length>3?v505.constant[3]:0;
  }
  }
  else{
  if(v16(v505.buffer)){
  v512=v8.createStream(34962,v505.buffer);
  }
  else{
  v512=v8.getBuffer(v505.buffer);
  }
  v515="type" in v505?v49[v505.type]:v512.dtype;
  v514=!!v505.normalized;
  v513=v505.size|0;
  v516=v505.offset|0;
  v517=v505.stride|0;
  v518=v505.divisor|0;
  }
  }
  v520=g519.state;
  g519.state=v507;
  v521=g519.x;
  g519.x=v508;
  v522=g519.y;
  g519.y=v509;
  v523=g519.z;
  g519.z=v510;
  v524=g519.w;
  g519.w=v511;
  v525=g519.buffer;
  g519.buffer=v512;
  v526=g519.size;
  g519.size=v513;
  v527=g519.normalized;
  g519.normalized=v514;
  v528=g519.type;
  g519.type=v515;
  v529=g519.offset;
  g519.offset=v516;
  v530=g519.stride;
  g519.stride=v517;
  v531=g519.divisor;
  g519.divisor=v518;
  v532=g127.call(this,v2,a0,a2);
  if(!(v532&&(typeof v532==="object"||typeof v532==="function")&&(v16(v532)||v8.getBuffer(v532)||v8.getBuffer(v532.buffer)||v16(v532.buffer)||("constant" in v532&&(typeof v532.constant==="number"||v17(v532.constant))))))g18.commandRaise(g129,g19);
  v533=false;
  v534=1;
  v535=0;
  v536=0;
  v537=0;
  v538=0;
  v539=null;
  v540=0;
  v541=false;
  v542=5126;
  v543=0;
  v544=0;
  v545=0;
  if(v16(v532)){
  v533=true;
  v539=v8.createStream(34962,v532);
  v542=v539.dtype;
  }
  else{
  v539=v8.getBuffer(v532);
  if(v539){
  v542=v539.dtype;
  }
  else if("constant" in v532){
  v534=2;
  if(typeof v532.constant === "number"){
  v535=v532.constant;
  v536=v537=v538=0;
  }
  else{
  v535=v532.constant.length>0?v532.constant[0]:0;
  v536=v532.constant.length>1?v532.constant[1]:0;
  v537=v532.constant.length>2?v532.constant[2]:0;
  v538=v532.constant.length>3?v532.constant[3]:0;
  }
  }
  else{
  if(v16(v532.buffer)){
  v539=v8.createStream(34962,v532.buffer);
  }
  else{
  v539=v8.getBuffer(v532.buffer);
  }
  v542="type" in v532?v49[v532.type]:v539.dtype;
  v541=!!v532.normalized;
  v540=v532.size|0;
  v543=v532.offset|0;
  v544=v532.stride|0;
  v545=v532.divisor|0;
  }
  }
  v547=g546.state;
  g546.state=v534;
  v548=g546.x;
  g546.x=v535;
  v549=g546.y;
  g546.y=v536;
  v550=g546.z;
  g546.z=v537;
  v551=g546.w;
  g546.w=v538;
  v552=g546.buffer;
  g546.buffer=v539;
  v553=g546.size;
  g546.size=v540;
  v554=g546.normalized;
  g546.normalized=v541;
  v555=g546.type;
  g546.type=v542;
  v556=g546.offset;
  g546.offset=v543;
  v557=g546.stride;
  g546.stride=v544;
  v558=g546.divisor;
  g546.divisor=v545;
  v559=g147.call(this,v2,a0,a2);
  if(!(v559&&(typeof v559==="object"||typeof v559==="function")&&(v16(v559)||v8.getBuffer(v559)||v8.getBuffer(v559.buffer)||v16(v559.buffer)||("constant" in v559&&(typeof v559.constant==="number"||v17(v559.constant))))))g18.commandRaise(g149,g19);
  v560=false;
  v561=1;
  v562=0;
  v563=0;
  v564=0;
  v565=0;
  v566=null;
  v567=0;
  v568=false;
  v569=5126;
  v570=0;
  v571=0;
  v572=0;
  if(v16(v559)){
  v560=true;
  v566=v8.createStream(34962,v559);
  v569=v566.dtype;
  }
  else{
  v566=v8.getBuffer(v559);
  if(v566){
  v569=v566.dtype;
  }
  else if("constant" in v559){
  v561=2;
  if(typeof v559.constant === "number"){
  v562=v559.constant;
  v563=v564=v565=0;
  }
  else{
  v562=v559.constant.length>0?v559.constant[0]:0;
  v563=v559.constant.length>1?v559.constant[1]:0;
  v564=v559.constant.length>2?v559.constant[2]:0;
  v565=v559.constant.length>3?v559.constant[3]:0;
  }
  }
  else{
  if(v16(v559.buffer)){
  v566=v8.createStream(34962,v559.buffer);
  }
  else{
  v566=v8.getBuffer(v559.buffer);
  }
  v569="type" in v559?v49[v559.type]:v566.dtype;
  v568=!!v559.normalized;
  v567=v559.size|0;
  v570=v559.offset|0;
  v571=v559.stride|0;
  v572=v559.divisor|0;
  }
  }
  v574=g573.state;
  g573.state=v561;
  v575=g573.x;
  g573.x=v562;
  v576=g573.y;
  g573.y=v563;
  v577=g573.z;
  g573.z=v564;
  v578=g573.w;
  g573.w=v565;
  v579=g573.buffer;
  g573.buffer=v566;
  v580=g573.size;
  g573.size=v567;
  v581=g573.normalized;
  g573.normalized=v568;
  v582=g573.type;
  g573.type=v569;
  v583=g573.offset;
  g573.offset=v570;
  v584=g573.stride;
  g573.stride=v571;
  v585=g573.divisor;
  g573.divisor=v572;
  v586=g107.call(this,v2,a0,a2);
  if(!(v586&&(typeof v586==="object"||typeof v586==="function")&&(v16(v586)||v8.getBuffer(v586)||v8.getBuffer(v586.buffer)||v16(v586.buffer)||("constant" in v586&&(typeof v586.constant==="number"||v17(v586.constant))))))g18.commandRaise(g109,g19);
  v587=false;
  v588=1;
  v589=0;
  v590=0;
  v591=0;
  v592=0;
  v593=null;
  v594=0;
  v595=false;
  v596=5126;
  v597=0;
  v598=0;
  v599=0;
  if(v16(v586)){
  v587=true;
  v593=v8.createStream(34962,v586);
  v596=v593.dtype;
  }
  else{
  v593=v8.getBuffer(v586);
  if(v593){
  v596=v593.dtype;
  }
  else if("constant" in v586){
  v588=2;
  if(typeof v586.constant === "number"){
  v589=v586.constant;
  v590=v591=v592=0;
  }
  else{
  v589=v586.constant.length>0?v586.constant[0]:0;
  v590=v586.constant.length>1?v586.constant[1]:0;
  v591=v586.constant.length>2?v586.constant[2]:0;
  v592=v586.constant.length>3?v586.constant[3]:0;
  }
  }
  else{
  if(v16(v586.buffer)){
  v593=v8.createStream(34962,v586.buffer);
  }
  else{
  v593=v8.getBuffer(v586.buffer);
  }
  v596="type" in v586?v49[v586.type]:v593.dtype;
  v595=!!v586.normalized;
  v594=v586.size|0;
  v597=v586.offset|0;
  v598=v586.stride|0;
  v599=v586.divisor|0;
  }
  }
  v601=g600.state;
  g600.state=v588;
  v602=g600.x;
  g600.x=v589;
  v603=g600.y;
  g600.y=v590;
  v604=g600.z;
  g600.z=v591;
  v605=g600.w;
  g600.w=v592;
  v606=g600.buffer;
  g600.buffer=v593;
  v607=g600.size;
  g600.size=v594;
  v608=g600.normalized;
  g600.normalized=v595;
  v609=g600.type;
  g600.type=v596;
  v610=g600.offset;
  g600.offset=v597;
  v611=g600.stride;
  g600.stride=v598;
  v612=g600.divisor;
  g600.divisor=v599;
  v613=g167.call(this,v2,a0,a2);
  if(!(v613&&(typeof v613==="object"||typeof v613==="function")&&(v16(v613)||v8.getBuffer(v613)||v8.getBuffer(v613.buffer)||v16(v613.buffer)||("constant" in v613&&(typeof v613.constant==="number"||v17(v613.constant))))))g18.commandRaise(g169,g19);
  v614=false;
  v615=1;
  v616=0;
  v617=0;
  v618=0;
  v619=0;
  v620=null;
  v621=0;
  v622=false;
  v623=5126;
  v624=0;
  v625=0;
  v626=0;
  if(v16(v613)){
  v614=true;
  v620=v8.createStream(34962,v613);
  v623=v620.dtype;
  }
  else{
  v620=v8.getBuffer(v613);
  if(v620){
  v623=v620.dtype;
  }
  else if("constant" in v613){
  v615=2;
  if(typeof v613.constant === "number"){
  v616=v613.constant;
  v617=v618=v619=0;
  }
  else{
  v616=v613.constant.length>0?v613.constant[0]:0;
  v617=v613.constant.length>1?v613.constant[1]:0;
  v618=v613.constant.length>2?v613.constant[2]:0;
  v619=v613.constant.length>3?v613.constant[3]:0;
  }
  }
  else{
  if(v16(v613.buffer)){
  v620=v8.createStream(34962,v613.buffer);
  }
  else{
  v620=v8.getBuffer(v613.buffer);
  }
  v623="type" in v613?v49[v613.type]:v620.dtype;
  v622=!!v613.normalized;
  v621=v613.size|0;
  v624=v613.offset|0;
  v625=v613.stride|0;
  v626=v613.divisor|0;
  }
  }
  v628=g627.state;
  g627.state=v615;
  v629=g627.x;
  g627.x=v616;
  v630=g627.y;
  g627.y=v617;
  v631=g627.z;
  g627.z=v618;
  v632=g627.w;
  g627.w=v619;
  v633=g627.buffer;
  g627.buffer=v620;
  v634=g627.size;
  g627.size=v621;
  v635=g627.normalized;
  g627.normalized=v622;
  v636=g627.type;
  g627.type=v623;
  v637=g627.offset;
  g627.offset=v624;
  v638=g627.stride;
  g627.stride=v625;
  v639=g627.divisor;
  g627.divisor=v626;
  v640=v9.vert;
  v9.vert=_gs[42];
  v641=v9.frag;
  v9.frag=_gs[43];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v340;
  v2.viewportHeight=v341;
  v42[0]=v342;
  v42[1]=v343;
  v42[2]=v344;
  v42[3]=v345;
  v20[0]=v346;
  v20[1]=v347;
  v20[2]=v348;
  v20[3]=v349;
  v4.blend_enable=v350;
  v24[0]=v351;
  v24[1]=v352;
  v24[2]=v353;
  v24[3]=v354;
  v4.depth_enable=v355;
  v40[0]=v361;
  v40[1]=v362;
  v40[2]=v363;
  v40[3]=v364;
  v4.scissor_enable=v365;
  v4.stencil_enable=v366;
  if(v367){
  g52.cpuTime+=performance.now()-v368;
  }
  if(v371){
  v7.destroyStream(v370);
  }
  v6.elements=v372;
  v6.offset=v374;
  v6.count=v376;
  v6.primitive=v377;
  v12[_gs[32]]=v378;
  v12[_gs[33]]=v380;
  v12[_gs[34]]=v382;
  v12[_gs[35]]=v384;
  v12[_gs[36]]=v386;
  v12[_gs[37]]=v388;
  v12[_gs[38]]=v390;
  v12[_gs[39]]=v392;
  v12[_gs[40]]=v394;
  v12[_gs[41]]=v396;
  if(v398){
  v8.destroyStream(v404);
  }
  g411.state=v412;
  g411.x=v413;
  g411.y=v414;
  g411.z=v415;
  g411.w=v416;
  g411.buffer=v417;
  g411.size=v418;
  g411.normalized=v419;
  g411.type=v420;
  g411.offset=v421;
  g411.stride=v422;
  g411.divisor=v423;
  if(v425){
  v8.destroyStream(v431);
  }
  g438.state=v439;
  g438.x=v440;
  g438.y=v441;
  g438.z=v442;
  g438.w=v443;
  g438.buffer=v444;
  g438.size=v445;
  g438.normalized=v446;
  g438.type=v447;
  g438.offset=v448;
  g438.stride=v449;
  g438.divisor=v450;
  if(v452){
  v8.destroyStream(v458);
  }
  g465.state=v466;
  g465.x=v467;
  g465.y=v468;
  g465.z=v469;
  g465.w=v470;
  g465.buffer=v471;
  g465.size=v472;
  g465.normalized=v473;
  g465.type=v474;
  g465.offset=v475;
  g465.stride=v476;
  g465.divisor=v477;
  if(v479){
  v8.destroyStream(v485);
  }
  g492.state=v493;
  g492.x=v494;
  g492.y=v495;
  g492.z=v496;
  g492.w=v497;
  g492.buffer=v498;
  g492.size=v499;
  g492.normalized=v500;
  g492.type=v501;
  g492.offset=v502;
  g492.stride=v503;
  g492.divisor=v504;
  if(v506){
  v8.destroyStream(v512);
  }
  g519.state=v520;
  g519.x=v521;
  g519.y=v522;
  g519.z=v523;
  g519.w=v524;
  g519.buffer=v525;
  g519.size=v526;
  g519.normalized=v527;
  g519.type=v528;
  g519.offset=v529;
  g519.stride=v530;
  g519.divisor=v531;
  if(v533){
  v8.destroyStream(v539);
  }
  g546.state=v547;
  g546.x=v548;
  g546.y=v549;
  g546.z=v550;
  g546.w=v551;
  g546.buffer=v552;
  g546.size=v553;
  g546.normalized=v554;
  g546.type=v555;
  g546.offset=v556;
  g546.stride=v557;
  g546.divisor=v558;
  if(v560){
  v8.destroyStream(v566);
  }
  g573.state=v574;
  g573.x=v575;
  g573.y=v576;
  g573.z=v577;
  g573.w=v578;
  g573.buffer=v579;
  g573.size=v580;
  g573.normalized=v581;
  g573.type=v582;
  g573.offset=v583;
  g573.stride=v584;
  g573.divisor=v585;
  if(v587){
  v8.destroyStream(v593);
  }
  g600.state=v601;
  g600.x=v602;
  g600.y=v603;
  g600.z=v604;
  g600.w=v605;
  g600.buffer=v606;
  g600.size=v607;
  g600.normalized=v608;
  g600.type=v609;
  g600.offset=v610;
  g600.stride=v611;
  g600.divisor=v612;
  if(v614){
  v8.destroyStream(v620);
  }
  g627.state=v628;
  g627.x=v629;
  g627.y=v630;
  g627.z=v631;
  g627.w=v632;
  g627.buffer=v633;
  g627.size=v634;
  g627.normalized=v635;
  g627.type=v636;
  g627.offset=v637;
  g627.stride=v638;
  g627.divisor=v639;
  v9.vert=v640;
  v9.frag=v641;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v642,v643,v678,v679,v680,v681,v682;
  v642=v14.angle_instanced_arrays;
  v643=v13.next;
  if(v643!==v13.cur){
  if(v643){
  v1.bindFramebuffer(36160,v643.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v643;
  }
  if(v5.dirty){
  var v644,v645,v646,v647,v648,v649,v650,v651,v652,v653,v654,v655,v656,v657,v658,v659,v660,v661,v662,v663,v664,v665,v666,v667,v668,v669,v670,v671,v672,v673,v674,v675,v676,v677;
  v644=v4.dither;
  if(v644!==v5.dither){
  if(v644){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v644;
  }
  v645=v22[0];
  v646=v22[1];
  if(v645!==v23[0]||v646!==v23[1]){
  v1.blendEquationSeparate(v645,v646);
  v23[0]=v645;
  v23[1]=v646;
  }
  v647=v4.depth_func;
  if(v647!==v5.depth_func){
  v1.depthFunc(v647);
  v5.depth_func=v647;
  }
  v648=v26[0];
  v649=v26[1];
  if(v648!==v27[0]||v649!==v27[1]){
  v1.depthRange(v648,v649);
  v27[0]=v648;
  v27[1]=v649;
  }
  v650=v4.depth_mask;
  if(v650!==v5.depth_mask){
  v1.depthMask(v650);
  v5.depth_mask=v650;
  }
  v651=v28[0];
  v652=v28[1];
  v653=v28[2];
  v654=v28[3];
  if(v651!==v29[0]||v652!==v29[1]||v653!==v29[2]||v654!==v29[3]){
  v1.colorMask(v651,v652,v653,v654);
  v29[0]=v651;
  v29[1]=v652;
  v29[2]=v653;
  v29[3]=v654;
  }
  v655=v4.cull_enable;
  if(v655!==v5.cull_enable){
  if(v655){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v655;
  }
  v656=v4.cull_face;
  if(v656!==v5.cull_face){
  v1.cullFace(v656);
  v5.cull_face=v656;
  }
  v657=v4.frontFace;
  if(v657!==v5.frontFace){
  v1.frontFace(v657);
  v5.frontFace=v657;
  }
  v658=v4.lineWidth;
  if(v658!==v5.lineWidth){
  v1.lineWidth(v658);
  v5.lineWidth=v658;
  }
  v659=v4.polygonOffset_enable;
  if(v659!==v5.polygonOffset_enable){
  if(v659){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v659;
  }
  v660=v30[0];
  v661=v30[1];
  if(v660!==v31[0]||v661!==v31[1]){
  v1.polygonOffset(v660,v661);
  v31[0]=v660;
  v31[1]=v661;
  }
  v662=v4.sample_alpha;
  if(v662!==v5.sample_alpha){
  if(v662){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v662;
  }
  v663=v4.sample_enable;
  if(v663!==v5.sample_enable){
  if(v663){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v663;
  }
  v664=v32[0];
  v665=v32[1];
  if(v664!==v33[0]||v665!==v33[1]){
  v1.sampleCoverage(v664,v665);
  v33[0]=v664;
  v33[1]=v665;
  }
  v666=v4.stencil_mask;
  if(v666!==v5.stencil_mask){
  v1.stencilMask(v666);
  v5.stencil_mask=v666;
  }
  v667=v34[0];
  v668=v34[1];
  v669=v34[2];
  if(v667!==v35[0]||v668!==v35[1]||v669!==v35[2]){
  v1.stencilFunc(v667,v668,v669);
  v35[0]=v667;
  v35[1]=v668;
  v35[2]=v669;
  }
  v670=v36[0];
  v671=v36[1];
  v672=v36[2];
  v673=v36[3];
  if(v670!==v37[0]||v671!==v37[1]||v672!==v37[2]||v673!==v37[3]){
  v1.stencilOpSeparate(v670,v671,v672,v673);
  v37[0]=v670;
  v37[1]=v671;
  v37[2]=v672;
  v37[3]=v673;
  }
  v674=v38[0];
  v675=v38[1];
  v676=v38[2];
  v677=v38[3];
  if(v674!==v39[0]||v675!==v39[1]||v676!==v39[2]||v677!==v39[3]){
  v1.stencilOpSeparate(v674,v675,v676,v677);
  v39[0]=v674;
  v39[1]=v675;
  v39[2]=v676;
  v39[3]=v677;
  }
  }
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[44]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[45];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[46]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[47];
  if(_gs[48]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[49];
  if(_gs[50]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[51];
  v678=v5.profile;
  if(v678){
  v679=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g105.program);
  v680=v14.angle_instanced_arrays;
  var v884;
  v11.setVAO(null);
  v1.uniform1i(g287.location,false);
  v1.uniform1i(g301.location,g302.bind());
  v884=v6.instances;
  for(v681=0;
  v681<a1;
  ++v681){
  v682=a0[v681];
  var v683,v684,v685,v686,v687,v688,v689,v690,v691,v692,v693,v694,v695,v696,v697,v698,v699,v700,v701,v702,v703,v704,v705,v706,v707,v708,v709,v710,v711,v712,v713,v714,v715,v716,v717,v718,v719,v720,v721,v722,v723,v724,v725,v726,v727,v728,v729,v730,v731,v732,v733,v734,v735,v736,v737,v738,v739,v740,v741,v742,v743,v744,v745,v746,v747,v748,v749,v750,v751,v752,v753,v754,v755,v756,v757,v758,v759,v760,v761,v762,v763,v764,v765,v766,v767,v768,v769,v770,v771,v772,v773,v774,v775,v776,v777,v778,v779,v780,v781,v782,v783,v784,v785,v786,v787,v788,v789,v790,v791,v792,v793,v794,v795,v796,v797,v798,v799,v800,v801,v802,v803,v804,v805,v806,v807,v808,v809,v810,v811,v812,v813,v814,v815,v816,v817,v818,v819,v820,v821,v822,v823,v824,v825,v826,v827,v828,v829,v830,v831,v832,v833,v834,v835,v836,v837,v838,v839,v840,v841,v842,v843,v844,v845,v846,v847,v848,v849,v850,v851,v852,v853,v854,v855,v856,v857,v858,v859,v860,v861,v862,v863,v864,v865,v866,v867,v868,v869,v870,v871,v872,v873,v874,v875,v876,v877,v878,v879,v880,v881,v882,v883;
  v683=v682["viewport"];
  if(!(v683&&typeof v683==="object"))g18.commandRaise(g90,g19);
  v684=v683.x|0;
  v685=v683.y|0;
  v686="width" in v683?v683.width|0:(v2.framebufferWidth-v684);
  v687="height" in v683?v683.height|0:(v2.framebufferHeight-v685);
  if(!(v686>=0&&v687>=0))g18.commandRaise(g90,g19);
  v688=v2.viewportWidth;
  v2.viewportWidth=v686;
  v689=v2.viewportHeight;
  v2.viewportHeight=v687;
  v1.viewport(v684,v685,v686,v687);
  v43[0]=v684;
  v43[1]=v685;
  v43[2]=v686;
  v43[3]=v687;
  v690=v682["viewport"];
  if(!(v690&&typeof v690==="object"))g18.commandRaise(g98,g19);
  v691=v690.x|0;
  v692=v690.y|0;
  v693="width" in v690?v690.width|0:(v2.framebufferWidth-v691);
  v694="height" in v690?v690.height|0:(v2.framebufferHeight-v692);
  if(!(v693>=0&&v694>=0))g18.commandRaise(g98,g19);
  v1.scissor(v691,v692,v693,v694);
  v41[0]=v691;
  v41[1]=v692;
  v41[2]=v693;
  v41[3]=v694;
  v695=g107.call(this,v2,v682,v681);
  if(!(v695&&(typeof v695==="object"||typeof v695==="function")&&(v16(v695)||v8.getBuffer(v695)||v8.getBuffer(v695.buffer)||v16(v695.buffer)||("constant" in v695&&(typeof v695.constant==="number"||v17(v695.constant))))))g18.commandRaise(g109,g19);
  v696=false;
  v697=1;
  v698=0;
  v699=0;
  v700=0;
  v701=0;
  v702=null;
  v703=0;
  v704=false;
  v705=5126;
  v706=0;
  v707=0;
  v708=0;
  if(v16(v695)){
  v696=true;
  v702=v8.createStream(34962,v695);
  v705=v702.dtype;
  }
  else{
  v702=v8.getBuffer(v695);
  if(v702){
  v705=v702.dtype;
  }
  else if("constant" in v695){
  v697=2;
  if(typeof v695.constant === "number"){
  v698=v695.constant;
  v699=v700=v701=0;
  }
  else{
  v698=v695.constant.length>0?v695.constant[0]:0;
  v699=v695.constant.length>1?v695.constant[1]:0;
  v700=v695.constant.length>2?v695.constant[2]:0;
  v701=v695.constant.length>3?v695.constant[3]:0;
  }
  }
  else{
  if(v16(v695.buffer)){
  v702=v8.createStream(34962,v695.buffer);
  }
  else{
  v702=v8.getBuffer(v695.buffer);
  }
  v705="type" in v695?v49[v695.type]:v702.dtype;
  v704=!!v695.normalized;
  v703=v695.size|0;
  v706=v695.offset|0;
  v707=v695.stride|0;
  v708=v695.divisor|0;
  }
  }
  v709=g123.location;
  v710=v10[v709];
  if(v697===1){
  if(!v710.buffer){
  v1.enableVertexAttribArray(v709);
  }
  v711=v703||4;
  if(v710.type!==v705||v710.size!==v711||v710.buffer!==v702||v710.normalized!==v704||v710.offset!==v706||v710.stride!==v707){
  v1.bindBuffer(34962,v702.buffer);
  v1.vertexAttribPointer(v709,v711,v705,v704,v707,v706);
  v710.type=v705;
  v710.size=v711;
  v710.buffer=v702;
  v710.normalized=v704;
  v710.offset=v706;
  v710.stride=v707;
  }
  if(v710.divisor!==v708){
  v680.vertexAttribDivisorANGLE(v709,v708);
  v710.divisor=v708;
  }
  }
  else{
  if(v710.buffer){
  v1.disableVertexAttribArray(v709);
  v710.buffer=null;
  }
  if(v710.x!==v698||v710.y!==v699||v710.z!==v700||v710.w!==v701){
  v1.vertexAttrib4f(v709,v698,v699,v700,v701);
  v710.x=v698;
  v710.y=v699;
  v710.z=v700;
  v710.w=v701;
  }
  }
  v712=g127.call(this,v2,v682,v681);
  if(!(v712&&(typeof v712==="object"||typeof v712==="function")&&(v16(v712)||v8.getBuffer(v712)||v8.getBuffer(v712.buffer)||v16(v712.buffer)||("constant" in v712&&(typeof v712.constant==="number"||v17(v712.constant))))))g18.commandRaise(g129,g19);
  v713=false;
  v714=1;
  v715=0;
  v716=0;
  v717=0;
  v718=0;
  v719=null;
  v720=0;
  v721=false;
  v722=5126;
  v723=0;
  v724=0;
  v725=0;
  if(v16(v712)){
  v713=true;
  v719=v8.createStream(34962,v712);
  v722=v719.dtype;
  }
  else{
  v719=v8.getBuffer(v712);
  if(v719){
  v722=v719.dtype;
  }
  else if("constant" in v712){
  v714=2;
  if(typeof v712.constant === "number"){
  v715=v712.constant;
  v716=v717=v718=0;
  }
  else{
  v715=v712.constant.length>0?v712.constant[0]:0;
  v716=v712.constant.length>1?v712.constant[1]:0;
  v717=v712.constant.length>2?v712.constant[2]:0;
  v718=v712.constant.length>3?v712.constant[3]:0;
  }
  }
  else{
  if(v16(v712.buffer)){
  v719=v8.createStream(34962,v712.buffer);
  }
  else{
  v719=v8.getBuffer(v712.buffer);
  }
  v722="type" in v712?v49[v712.type]:v719.dtype;
  v721=!!v712.normalized;
  v720=v712.size|0;
  v723=v712.offset|0;
  v724=v712.stride|0;
  v725=v712.divisor|0;
  }
  }
  v726=g143.location;
  v727=v10[v726];
  if(v714===1){
  if(!v727.buffer){
  v1.enableVertexAttribArray(v726);
  }
  v728=v720||1;
  if(v727.type!==v722||v727.size!==v728||v727.buffer!==v719||v727.normalized!==v721||v727.offset!==v723||v727.stride!==v724){
  v1.bindBuffer(34962,v719.buffer);
  v1.vertexAttribPointer(v726,v728,v722,v721,v724,v723);
  v727.type=v722;
  v727.size=v728;
  v727.buffer=v719;
  v727.normalized=v721;
  v727.offset=v723;
  v727.stride=v724;
  }
  if(v727.divisor!==v725){
  v680.vertexAttribDivisorANGLE(v726,v725);
  v727.divisor=v725;
  }
  }
  else{
  if(v727.buffer){
  v1.disableVertexAttribArray(v726);
  v727.buffer=null;
  }
  if(v727.x!==v715||v727.y!==v716||v727.z!==v717||v727.w!==v718){
  v1.vertexAttrib4f(v726,v715,v716,v717,v718);
  v727.x=v715;
  v727.y=v716;
  v727.z=v717;
  v727.w=v718;
  }
  }
  v729=g147.call(this,v2,v682,v681);
  if(!(v729&&(typeof v729==="object"||typeof v729==="function")&&(v16(v729)||v8.getBuffer(v729)||v8.getBuffer(v729.buffer)||v16(v729.buffer)||("constant" in v729&&(typeof v729.constant==="number"||v17(v729.constant))))))g18.commandRaise(g149,g19);
  v730=false;
  v731=1;
  v732=0;
  v733=0;
  v734=0;
  v735=0;
  v736=null;
  v737=0;
  v738=false;
  v739=5126;
  v740=0;
  v741=0;
  v742=0;
  if(v16(v729)){
  v730=true;
  v736=v8.createStream(34962,v729);
  v739=v736.dtype;
  }
  else{
  v736=v8.getBuffer(v729);
  if(v736){
  v739=v736.dtype;
  }
  else if("constant" in v729){
  v731=2;
  if(typeof v729.constant === "number"){
  v732=v729.constant;
  v733=v734=v735=0;
  }
  else{
  v732=v729.constant.length>0?v729.constant[0]:0;
  v733=v729.constant.length>1?v729.constant[1]:0;
  v734=v729.constant.length>2?v729.constant[2]:0;
  v735=v729.constant.length>3?v729.constant[3]:0;
  }
  }
  else{
  if(v16(v729.buffer)){
  v736=v8.createStream(34962,v729.buffer);
  }
  else{
  v736=v8.getBuffer(v729.buffer);
  }
  v739="type" in v729?v49[v729.type]:v736.dtype;
  v738=!!v729.normalized;
  v737=v729.size|0;
  v740=v729.offset|0;
  v741=v729.stride|0;
  v742=v729.divisor|0;
  }
  }
  v743=g163.location;
  v744=v10[v743];
  if(v731===1){
  if(!v744.buffer){
  v1.enableVertexAttribArray(v743);
  }
  v745=v737||4;
  if(v744.type!==v739||v744.size!==v745||v744.buffer!==v736||v744.normalized!==v738||v744.offset!==v740||v744.stride!==v741){
  v1.bindBuffer(34962,v736.buffer);
  v1.vertexAttribPointer(v743,v745,v739,v738,v741,v740);
  v744.type=v739;
  v744.size=v745;
  v744.buffer=v736;
  v744.normalized=v738;
  v744.offset=v740;
  v744.stride=v741;
  }
  if(v744.divisor!==v742){
  v680.vertexAttribDivisorANGLE(v743,v742);
  v744.divisor=v742;
  }
  }
  else{
  if(v744.buffer){
  v1.disableVertexAttribArray(v743);
  v744.buffer=null;
  }
  if(v744.x!==v732||v744.y!==v733||v744.z!==v734||v744.w!==v735){
  v1.vertexAttrib4f(v743,v732,v733,v734,v735);
  v744.x=v732;
  v744.y=v733;
  v744.z=v734;
  v744.w=v735;
  }
  }
  v746=g167.call(this,v2,v682,v681);
  if(!(v746&&(typeof v746==="object"||typeof v746==="function")&&(v16(v746)||v8.getBuffer(v746)||v8.getBuffer(v746.buffer)||v16(v746.buffer)||("constant" in v746&&(typeof v746.constant==="number"||v17(v746.constant))))))g18.commandRaise(g169,g19);
  v747=false;
  v748=1;
  v749=0;
  v750=0;
  v751=0;
  v752=0;
  v753=null;
  v754=0;
  v755=false;
  v756=5126;
  v757=0;
  v758=0;
  v759=0;
  if(v16(v746)){
  v747=true;
  v753=v8.createStream(34962,v746);
  v756=v753.dtype;
  }
  else{
  v753=v8.getBuffer(v746);
  if(v753){
  v756=v753.dtype;
  }
  else if("constant" in v746){
  v748=2;
  if(typeof v746.constant === "number"){
  v749=v746.constant;
  v750=v751=v752=0;
  }
  else{
  v749=v746.constant.length>0?v746.constant[0]:0;
  v750=v746.constant.length>1?v746.constant[1]:0;
  v751=v746.constant.length>2?v746.constant[2]:0;
  v752=v746.constant.length>3?v746.constant[3]:0;
  }
  }
  else{
  if(v16(v746.buffer)){
  v753=v8.createStream(34962,v746.buffer);
  }
  else{
  v753=v8.getBuffer(v746.buffer);
  }
  v756="type" in v746?v49[v746.type]:v753.dtype;
  v755=!!v746.normalized;
  v754=v746.size|0;
  v757=v746.offset|0;
  v758=v746.stride|0;
  v759=v746.divisor|0;
  }
  }
  v760=g183.location;
  v761=v10[v760];
  if(v748===1){
  if(!v761.buffer){
  v1.enableVertexAttribArray(v760);
  }
  v762=v754||1;
  if(v761.type!==v756||v761.size!==v762||v761.buffer!==v753||v761.normalized!==v755||v761.offset!==v757||v761.stride!==v758){
  v1.bindBuffer(34962,v753.buffer);
  v1.vertexAttribPointer(v760,v762,v756,v755,v758,v757);
  v761.type=v756;
  v761.size=v762;
  v761.buffer=v753;
  v761.normalized=v755;
  v761.offset=v757;
  v761.stride=v758;
  }
  if(v761.divisor!==v759){
  v680.vertexAttribDivisorANGLE(v760,v759);
  v761.divisor=v759;
  }
  }
  else{
  if(v761.buffer){
  v1.disableVertexAttribArray(v760);
  v761.buffer=null;
  }
  if(v761.x!==v749||v761.y!==v750||v761.z!==v751||v761.w!==v752){
  v1.vertexAttrib4f(v760,v749,v750,v751,v752);
  v761.x=v749;
  v761.y=v750;
  v761.z=v751;
  v761.w=v752;
  }
  }
  v763=g187.call(this,v2,v682,v681);
  if(!(v763&&(typeof v763==="object"||typeof v763==="function")&&(v16(v763)||v8.getBuffer(v763)||v8.getBuffer(v763.buffer)||v16(v763.buffer)||("constant" in v763&&(typeof v763.constant==="number"||v17(v763.constant))))))g18.commandRaise(g189,g19);
  v764=false;
  v765=1;
  v766=0;
  v767=0;
  v768=0;
  v769=0;
  v770=null;
  v771=0;
  v772=false;
  v773=5126;
  v774=0;
  v775=0;
  v776=0;
  if(v16(v763)){
  v764=true;
  v770=v8.createStream(34962,v763);
  v773=v770.dtype;
  }
  else{
  v770=v8.getBuffer(v763);
  if(v770){
  v773=v770.dtype;
  }
  else if("constant" in v763){
  v765=2;
  if(typeof v763.constant === "number"){
  v766=v763.constant;
  v767=v768=v769=0;
  }
  else{
  v766=v763.constant.length>0?v763.constant[0]:0;
  v767=v763.constant.length>1?v763.constant[1]:0;
  v768=v763.constant.length>2?v763.constant[2]:0;
  v769=v763.constant.length>3?v763.constant[3]:0;
  }
  }
  else{
  if(v16(v763.buffer)){
  v770=v8.createStream(34962,v763.buffer);
  }
  else{
  v770=v8.getBuffer(v763.buffer);
  }
  v773="type" in v763?v49[v763.type]:v770.dtype;
  v772=!!v763.normalized;
  v771=v763.size|0;
  v774=v763.offset|0;
  v775=v763.stride|0;
  v776=v763.divisor|0;
  }
  }
  v777=g203.location;
  v778=v10[v777];
  if(v765===1){
  if(!v778.buffer){
  v1.enableVertexAttribArray(v777);
  }
  v779=v771||1;
  if(v778.type!==v773||v778.size!==v779||v778.buffer!==v770||v778.normalized!==v772||v778.offset!==v774||v778.stride!==v775){
  v1.bindBuffer(34962,v770.buffer);
  v1.vertexAttribPointer(v777,v779,v773,v772,v775,v774);
  v778.type=v773;
  v778.size=v779;
  v778.buffer=v770;
  v778.normalized=v772;
  v778.offset=v774;
  v778.stride=v775;
  }
  if(v778.divisor!==v776){
  v680.vertexAttribDivisorANGLE(v777,v776);
  v778.divisor=v776;
  }
  }
  else{
  if(v778.buffer){
  v1.disableVertexAttribArray(v777);
  v778.buffer=null;
  }
  if(v778.x!==v766||v778.y!==v767||v778.z!==v768||v778.w!==v769){
  v1.vertexAttrib4f(v777,v766,v767,v768,v769);
  v778.x=v766;
  v778.y=v767;
  v778.z=v768;
  v778.w=v769;
  }
  }
  v780=g207.call(this,v2,v682,v681);
  if(!(v780&&(typeof v780==="object"||typeof v780==="function")&&(v16(v780)||v8.getBuffer(v780)||v8.getBuffer(v780.buffer)||v16(v780.buffer)||("constant" in v780&&(typeof v780.constant==="number"||v17(v780.constant))))))g18.commandRaise(g209,g19);
  v781=false;
  v782=1;
  v783=0;
  v784=0;
  v785=0;
  v786=0;
  v787=null;
  v788=0;
  v789=false;
  v790=5126;
  v791=0;
  v792=0;
  v793=0;
  if(v16(v780)){
  v781=true;
  v787=v8.createStream(34962,v780);
  v790=v787.dtype;
  }
  else{
  v787=v8.getBuffer(v780);
  if(v787){
  v790=v787.dtype;
  }
  else if("constant" in v780){
  v782=2;
  if(typeof v780.constant === "number"){
  v783=v780.constant;
  v784=v785=v786=0;
  }
  else{
  v783=v780.constant.length>0?v780.constant[0]:0;
  v784=v780.constant.length>1?v780.constant[1]:0;
  v785=v780.constant.length>2?v780.constant[2]:0;
  v786=v780.constant.length>3?v780.constant[3]:0;
  }
  }
  else{
  if(v16(v780.buffer)){
  v787=v8.createStream(34962,v780.buffer);
  }
  else{
  v787=v8.getBuffer(v780.buffer);
  }
  v790="type" in v780?v49[v780.type]:v787.dtype;
  v789=!!v780.normalized;
  v788=v780.size|0;
  v791=v780.offset|0;
  v792=v780.stride|0;
  v793=v780.divisor|0;
  }
  }
  v794=g223.location;
  v795=v10[v794];
  if(v782===1){
  if(!v795.buffer){
  v1.enableVertexAttribArray(v794);
  }
  v796=v788||1;
  if(v795.type!==v790||v795.size!==v796||v795.buffer!==v787||v795.normalized!==v789||v795.offset!==v791||v795.stride!==v792){
  v1.bindBuffer(34962,v787.buffer);
  v1.vertexAttribPointer(v794,v796,v790,v789,v792,v791);
  v795.type=v790;
  v795.size=v796;
  v795.buffer=v787;
  v795.normalized=v789;
  v795.offset=v791;
  v795.stride=v792;
  }
  if(v795.divisor!==v793){
  v680.vertexAttribDivisorANGLE(v794,v793);
  v795.divisor=v793;
  }
  }
  else{
  if(v795.buffer){
  v1.disableVertexAttribArray(v794);
  v795.buffer=null;
  }
  if(v795.x!==v783||v795.y!==v784||v795.z!==v785||v795.w!==v786){
  v1.vertexAttrib4f(v794,v783,v784,v785,v786);
  v795.x=v783;
  v795.y=v784;
  v795.z=v785;
  v795.w=v786;
  }
  }
  v797=g227.call(this,v2,v682,v681);
  if(!(v797&&(typeof v797==="object"||typeof v797==="function")&&(v16(v797)||v8.getBuffer(v797)||v8.getBuffer(v797.buffer)||v16(v797.buffer)||("constant" in v797&&(typeof v797.constant==="number"||v17(v797.constant))))))g18.commandRaise(g229,g19);
  v798=false;
  v799=1;
  v800=0;
  v801=0;
  v802=0;
  v803=0;
  v804=null;
  v805=0;
  v806=false;
  v807=5126;
  v808=0;
  v809=0;
  v810=0;
  if(v16(v797)){
  v798=true;
  v804=v8.createStream(34962,v797);
  v807=v804.dtype;
  }
  else{
  v804=v8.getBuffer(v797);
  if(v804){
  v807=v804.dtype;
  }
  else if("constant" in v797){
  v799=2;
  if(typeof v797.constant === "number"){
  v800=v797.constant;
  v801=v802=v803=0;
  }
  else{
  v800=v797.constant.length>0?v797.constant[0]:0;
  v801=v797.constant.length>1?v797.constant[1]:0;
  v802=v797.constant.length>2?v797.constant[2]:0;
  v803=v797.constant.length>3?v797.constant[3]:0;
  }
  }
  else{
  if(v16(v797.buffer)){
  v804=v8.createStream(34962,v797.buffer);
  }
  else{
  v804=v8.getBuffer(v797.buffer);
  }
  v807="type" in v797?v49[v797.type]:v804.dtype;
  v806=!!v797.normalized;
  v805=v797.size|0;
  v808=v797.offset|0;
  v809=v797.stride|0;
  v810=v797.divisor|0;
  }
  }
  v811=g243.location;
  v812=v10[v811];
  if(v799===1){
  if(!v812.buffer){
  v1.enableVertexAttribArray(v811);
  }
  v813=v805||1;
  if(v812.type!==v807||v812.size!==v813||v812.buffer!==v804||v812.normalized!==v806||v812.offset!==v808||v812.stride!==v809){
  v1.bindBuffer(34962,v804.buffer);
  v1.vertexAttribPointer(v811,v813,v807,v806,v809,v808);
  v812.type=v807;
  v812.size=v813;
  v812.buffer=v804;
  v812.normalized=v806;
  v812.offset=v808;
  v812.stride=v809;
  }
  if(v812.divisor!==v810){
  v680.vertexAttribDivisorANGLE(v811,v810);
  v812.divisor=v810;
  }
  }
  else{
  if(v812.buffer){
  v1.disableVertexAttribArray(v811);
  v812.buffer=null;
  }
  if(v812.x!==v800||v812.y!==v801||v812.z!==v802||v812.w!==v803){
  v1.vertexAttrib4f(v811,v800,v801,v802,v803);
  v812.x=v800;
  v812.y=v801;
  v812.z=v802;
  v812.w=v803;
  }
  }
  v814=g247.call(this,v2,v682,v681);
  if(!(v814&&(typeof v814==="object"||typeof v814==="function")&&(v16(v814)||v8.getBuffer(v814)||v8.getBuffer(v814.buffer)||v16(v814.buffer)||("constant" in v814&&(typeof v814.constant==="number"||v17(v814.constant))))))g18.commandRaise(g249,g19);
  v815=false;
  v816=1;
  v817=0;
  v818=0;
  v819=0;
  v820=0;
  v821=null;
  v822=0;
  v823=false;
  v824=5126;
  v825=0;
  v826=0;
  v827=0;
  if(v16(v814)){
  v815=true;
  v821=v8.createStream(34962,v814);
  v824=v821.dtype;
  }
  else{
  v821=v8.getBuffer(v814);
  if(v821){
  v824=v821.dtype;
  }
  else if("constant" in v814){
  v816=2;
  if(typeof v814.constant === "number"){
  v817=v814.constant;
  v818=v819=v820=0;
  }
  else{
  v817=v814.constant.length>0?v814.constant[0]:0;
  v818=v814.constant.length>1?v814.constant[1]:0;
  v819=v814.constant.length>2?v814.constant[2]:0;
  v820=v814.constant.length>3?v814.constant[3]:0;
  }
  }
  else{
  if(v16(v814.buffer)){
  v821=v8.createStream(34962,v814.buffer);
  }
  else{
  v821=v8.getBuffer(v814.buffer);
  }
  v824="type" in v814?v49[v814.type]:v821.dtype;
  v823=!!v814.normalized;
  v822=v814.size|0;
  v825=v814.offset|0;
  v826=v814.stride|0;
  v827=v814.divisor|0;
  }
  }
  v828=g263.location;
  v829=v10[v828];
  if(v816===1){
  if(!v829.buffer){
  v1.enableVertexAttribArray(v828);
  }
  v830=v822||1;
  if(v829.type!==v824||v829.size!==v830||v829.buffer!==v821||v829.normalized!==v823||v829.offset!==v825||v829.stride!==v826){
  v1.bindBuffer(34962,v821.buffer);
  v1.vertexAttribPointer(v828,v830,v824,v823,v826,v825);
  v829.type=v824;
  v829.size=v830;
  v829.buffer=v821;
  v829.normalized=v823;
  v829.offset=v825;
  v829.stride=v826;
  }
  if(v829.divisor!==v827){
  v680.vertexAttribDivisorANGLE(v828,v827);
  v829.divisor=v827;
  }
  }
  else{
  if(v829.buffer){
  v1.disableVertexAttribArray(v828);
  v829.buffer=null;
  }
  if(v829.x!==v817||v829.y!==v818||v829.z!==v819||v829.w!==v820){
  v1.vertexAttrib4f(v828,v817,v818,v819,v820);
  v829.x=v817;
  v829.y=v818;
  v829.z=v819;
  v829.w=v820;
  }
  }
  v831=g267.call(this,v2,v682,v681);
  if(!(v831&&(typeof v831==="object"||typeof v831==="function")&&(v16(v831)||v8.getBuffer(v831)||v8.getBuffer(v831.buffer)||v16(v831.buffer)||("constant" in v831&&(typeof v831.constant==="number"||v17(v831.constant))))))g18.commandRaise(g269,g19);
  v832=false;
  v833=1;
  v834=0;
  v835=0;
  v836=0;
  v837=0;
  v838=null;
  v839=0;
  v840=false;
  v841=5126;
  v842=0;
  v843=0;
  v844=0;
  if(v16(v831)){
  v832=true;
  v838=v8.createStream(34962,v831);
  v841=v838.dtype;
  }
  else{
  v838=v8.getBuffer(v831);
  if(v838){
  v841=v838.dtype;
  }
  else if("constant" in v831){
  v833=2;
  if(typeof v831.constant === "number"){
  v834=v831.constant;
  v835=v836=v837=0;
  }
  else{
  v834=v831.constant.length>0?v831.constant[0]:0;
  v835=v831.constant.length>1?v831.constant[1]:0;
  v836=v831.constant.length>2?v831.constant[2]:0;
  v837=v831.constant.length>3?v831.constant[3]:0;
  }
  }
  else{
  if(v16(v831.buffer)){
  v838=v8.createStream(34962,v831.buffer);
  }
  else{
  v838=v8.getBuffer(v831.buffer);
  }
  v841="type" in v831?v49[v831.type]:v838.dtype;
  v840=!!v831.normalized;
  v839=v831.size|0;
  v842=v831.offset|0;
  v843=v831.stride|0;
  v844=v831.divisor|0;
  }
  }
  v845=g283.location;
  v846=v10[v845];
  if(v833===1){
  if(!v846.buffer){
  v1.enableVertexAttribArray(v845);
  }
  v847=v839||1;
  if(v846.type!==v841||v846.size!==v847||v846.buffer!==v838||v846.normalized!==v840||v846.offset!==v842||v846.stride!==v843){
  v1.bindBuffer(34962,v838.buffer);
  v1.vertexAttribPointer(v845,v847,v841,v840,v843,v842);
  v846.type=v841;
  v846.size=v847;
  v846.buffer=v838;
  v846.normalized=v840;
  v846.offset=v842;
  v846.stride=v843;
  }
  if(v846.divisor!==v844){
  v680.vertexAttribDivisorANGLE(v845,v844);
  v846.divisor=v844;
  }
  }
  else{
  if(v846.buffer){
  v1.disableVertexAttribArray(v845);
  v846.buffer=null;
  }
  if(v846.x!==v834||v846.y!==v835||v846.z!==v836||v846.w!==v837){
  v1.vertexAttrib4f(v845,v834,v835,v836,v837);
  v846.x=v834;
  v846.y=v835;
  v846.z=v836;
  v846.w=v837;
  }
  }
  v848=v682["markerTexture"];
  if(v848&&v848._reglType==="framebuffer"){
  v848=v848.color[0];
  }
  if(!(typeof v848==="function"&&v848._reglType==="texture2d"))g18.commandRaise(g290,g19);
  v849=v848._texture;
  v1.uniform1i(g288.location,v849.bind());
  v850=v682["opacity"];
  if(!(typeof v850==="number"))g18.commandRaise(g294,g19);
  if(!v681||v851!==v850){
  v851=v850;
  v1.uniform1f(g292.location,v850);
  }
  v852=g296.call(this,v2,v682,v681);
  if(!(v17(v852)&&v852.length===2))g18.commandRaise(g298,g19);
  v853=v852[0];
  v855=v852[1];
  if(!v681||v854!==v853||v856!==v855){
  v854=v853;
  v856=v855;
  v1.uniform2f(g295.location,v853,v855);
  }
  v857=v2["pixelRatio"];
  if(!(typeof v857==="number"))g18.commandRaise(g305,g19);
  if(!v681||v858!==v857){
  v858=v857;
  v1.uniform1f(g303.location,v857);
  }
  v859=v682["scale"];
  if(!(v17(v859)&&v859.length===2))g18.commandRaise(g308,g19);
  v860=v859[0];
  v862=v859[1];
  if(!v681||v861!==v860||v863!==v862){
  v861=v860;
  v863=v862;
  v1.uniform2f(g306.location,v860,v862);
  }
  v864=v682["scaleFract"];
  if(!(v17(v864)&&v864.length===2))g18.commandRaise(g313,g19);
  v865=v864[0];
  v867=v864[1];
  if(!v681||v866!==v865||v868!==v867){
  v866=v865;
  v868=v867;
  v1.uniform2f(g311.location,v865,v867);
  }
  v869=v682["translate"];
  if(!(v17(v869)&&v869.length===2))g18.commandRaise(g318,g19);
  v870=v869[0];
  v872=v869[1];
  if(!v681||v871!==v870||v873!==v872){
  v871=v870;
  v873=v872;
  v1.uniform2f(g316.location,v870,v872);
  }
  v874=v682["translateFract"];
  if(!(v17(v874)&&v874.length===2))g18.commandRaise(g323,g19);
  v875=v874[0];
  v877=v874[1];
  if(!v681||v876!==v875||v878!==v877){
  v876=v875;
  v878=v877;
  v1.uniform2f(g321.location,v875,v877);
  }
  v879=v682["elements"];
  v880=null;
  v881=v16(v879);
  if(v881){
  v880=v7.createStream(v879);
  }
  else{
  v880=v7.getElements(v879);
  if(!(!v879||v880))g18.commandRaise(g329,g19);
  }
  if(v880)v1.bindBuffer(34963,v880.buffer.buffer);
  v882=v682["offset"];
  if(!(v882>=0))g18.commandRaise(g331,g19);
  v883=v682["count"];
  if(!(typeof v883==="number"&&v883>=0&&v883===(v883|0)))g18.commandRaise(g333,g19);
  if(v883){
  if(v884>0){
  if(v880){
  v680.drawElementsInstancedANGLE(0,v883,v880.type,v882<<((v880.type-5121)>>1),v884);
  }
  else{
  v680.drawArraysInstancedANGLE(0,v882,v883,v884);
  }
  }
  else if(v884<0){
  if(v880){
  v1.drawElements(0,v883,v880.type,v882<<((v880.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v882,v883);
  }
  }
  v2.viewportWidth=v688;
  v2.viewportHeight=v689;
  if(v696){
  v8.destroyStream(v702);
  }
  if(v713){
  v8.destroyStream(v719);
  }
  if(v730){
  v8.destroyStream(v736);
  }
  if(v747){
  v8.destroyStream(v753);
  }
  if(v764){
  v8.destroyStream(v770);
  }
  if(v781){
  v8.destroyStream(v787);
  }
  if(v798){
  v8.destroyStream(v804);
  }
  if(v815){
  v8.destroyStream(v821);
  }
  if(v832){
  v8.destroyStream(v838);
  }
  v849.unbind();
  if(v881){
  v7.destroyStream(v880);
  }
  }
  }
  g302.unbind();
  v5.dirty=true;
  v11.setVAO(null);
  if(v678){
  g52.cpuTime+=performance.now()-v679;
  }
  }
  ,}
  
  },
  "72326.317": function (_gs, g0, g18, g19, g52, g90, g98, g105, g107, g109, g123, g127, g129, g143, g147, g149, g163, g167, g169, g183, g187, g189, g203, g207, g209, g223, g227, g229, g243, g247, g249, g263, g267, g269, g283, g287, g288, g290, g291, g292, g294, g297, g298, g299, g301, g302, g304, g307, g309, g312, g314, g317, g319, g325, g327, g329, g375, g407, g434, g461, g488, g515, g542, g569, g596, g623) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  return {
  "draw":function(a0){
  var v53,v54,v89,v91,v92,v93,v94,v95,v96,v97,v99,v100,v101,v102,v103,v104,v106,v108,v110,v111,v112,v113,v114,v115,v116,v117,v118,v119,v120,v121,v122,v124,v125,v126,v128,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,v142,v144,v145,v146,v148,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v164,v165,v166,v168,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v184,v185,v186,v188,v190,v191,v192,v193,v194,v195,v196,v197,v198,v199,v200,v201,v202,v204,v205,v206,v208,v210,v211,v212,v213,v214,v215,v216,v217,v218,v219,v220,v221,v222,v224,v225,v226,v228,v230,v231,v232,v233,v234,v235,v236,v237,v238,v239,v240,v241,v242,v244,v245,v246,v248,v250,v251,v252,v253,v254,v255,v256,v257,v258,v259,v260,v261,v262,v264,v265,v266,v268,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v284,v285,v286,v289,v293,v295,v296,v300,v303,v305,v306,v308,v310,v311,v313,v315,v316,v318,v320,v321,v322,v323,v324,v326,v328,v330;
  v53=v14.angle_instanced_arrays;
  v54=v13.next;
  if(v54!==v13.cur){
  if(v54){
  v1.bindFramebuffer(36160,v54.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v54;
  }
  if(v5.dirty){
  var v55,v56,v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88;
  v55=v4.dither;
  if(v55!==v5.dither){
  if(v55){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v55;
  }
  v56=v22[0];
  v57=v22[1];
  if(v56!==v23[0]||v57!==v23[1]){
  v1.blendEquationSeparate(v56,v57);
  v23[0]=v56;
  v23[1]=v57;
  }
  v58=v4.depth_func;
  if(v58!==v5.depth_func){
  v1.depthFunc(v58);
  v5.depth_func=v58;
  }
  v59=v26[0];
  v60=v26[1];
  if(v59!==v27[0]||v60!==v27[1]){
  v1.depthRange(v59,v60);
  v27[0]=v59;
  v27[1]=v60;
  }
  v61=v4.depth_mask;
  if(v61!==v5.depth_mask){
  v1.depthMask(v61);
  v5.depth_mask=v61;
  }
  v62=v28[0];
  v63=v28[1];
  v64=v28[2];
  v65=v28[3];
  if(v62!==v29[0]||v63!==v29[1]||v64!==v29[2]||v65!==v29[3]){
  v1.colorMask(v62,v63,v64,v65);
  v29[0]=v62;
  v29[1]=v63;
  v29[2]=v64;
  v29[3]=v65;
  }
  v66=v4.cull_enable;
  if(v66!==v5.cull_enable){
  if(v66){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v66;
  }
  v67=v4.cull_face;
  if(v67!==v5.cull_face){
  v1.cullFace(v67);
  v5.cull_face=v67;
  }
  v68=v4.frontFace;
  if(v68!==v5.frontFace){
  v1.frontFace(v68);
  v5.frontFace=v68;
  }
  v69=v4.lineWidth;
  if(v69!==v5.lineWidth){
  v1.lineWidth(v69);
  v5.lineWidth=v69;
  }
  v70=v4.polygonOffset_enable;
  if(v70!==v5.polygonOffset_enable){
  if(v70){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v70;
  }
  v71=v30[0];
  v72=v30[1];
  if(v71!==v31[0]||v72!==v31[1]){
  v1.polygonOffset(v71,v72);
  v31[0]=v71;
  v31[1]=v72;
  }
  v73=v4.sample_alpha;
  if(v73!==v5.sample_alpha){
  if(v73){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v73;
  }
  v74=v4.sample_enable;
  if(v74!==v5.sample_enable){
  if(v74){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v74;
  }
  v75=v32[0];
  v76=v32[1];
  if(v75!==v33[0]||v76!==v33[1]){
  v1.sampleCoverage(v75,v76);
  v33[0]=v75;
  v33[1]=v76;
  }
  v77=v4.stencil_mask;
  if(v77!==v5.stencil_mask){
  v1.stencilMask(v77);
  v5.stencil_mask=v77;
  }
  v78=v34[0];
  v79=v34[1];
  v80=v34[2];
  if(v78!==v35[0]||v79!==v35[1]||v80!==v35[2]){
  v1.stencilFunc(v78,v79,v80);
  v35[0]=v78;
  v35[1]=v79;
  v35[2]=v80;
  }
  v81=v36[0];
  v82=v36[1];
  v83=v36[2];
  v84=v36[3];
  if(v81!==v37[0]||v82!==v37[1]||v83!==v37[2]||v84!==v37[3]){
  v1.stencilOpSeparate(v81,v82,v83,v84);
  v37[0]=v81;
  v37[1]=v82;
  v37[2]=v83;
  v37[3]=v84;
  }
  v85=v38[0];
  v86=v38[1];
  v87=v38[2];
  v88=v38[3];
  if(v85!==v39[0]||v86!==v39[1]||v87!==v39[2]||v88!==v39[3]){
  v1.stencilOpSeparate(v85,v86,v87,v88);
  v39[0]=v85;
  v39[1]=v86;
  v39[2]=v87;
  v39[3]=v88;
  }
  }
  v89=a0["viewport"];
  if(!(v89&&typeof v89==="object"))g18.commandRaise(g90,g19);
  v91=v89.x|0;
  v92=v89.y|0;
  v93="width" in v89?v89.width|0:(v2.framebufferWidth-v91);
  v94="height" in v89?v89.height|0:(v2.framebufferHeight-v92);
  if(!(v93>=0&&v94>=0))g18.commandRaise(g90,g19);
  v95=v2.viewportWidth;
  v2.viewportWidth=v93;
  v96=v2.viewportHeight;
  v2.viewportHeight=v94;
  v1.viewport(v91,v92,v93,v94);
  v43[0]=v91;
  v43[1]=v92;
  v43[2]=v93;
  v43[3]=v94;
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[3];
  v97=a0["viewport"];
  if(!(v97&&typeof v97==="object"))g18.commandRaise(g98,g19);
  v99=v97.x|0;
  v100=v97.y|0;
  v101="width" in v97?v97.width|0:(v2.framebufferWidth-v99);
  v102="height" in v97?v97.height|0:(v2.framebufferHeight-v100);
  if(!(v101>=0&&v102>=0))g18.commandRaise(g98,g19);
  v1.scissor(v99,v100,v101,v102);
  v41[0]=v99;
  v41[1]=v100;
  v41[2]=v101;
  v41[3]=v102;
  if(_gs[4]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[5];
  if(_gs[6]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[7];
  v103=v5.profile;
  if(v103){
  v104=performance.now();
  g52.count++;
  }
  v1.useProgram(g105.program);
  v106=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v108=g107.call(this,v2,a0,0);
  if(!(v108&&(typeof v108==="object"||typeof v108==="function")&&(v16(v108)||v8.getBuffer(v108)||v8.getBuffer(v108.buffer)||v16(v108.buffer)||("constant" in v108&&(typeof v108.constant==="number"||v17(v108.constant))))))g18.commandRaise(g109,g19);
  v110=false;
  v111=1;
  v112=0;
  v113=0;
  v114=0;
  v115=0;
  v116=null;
  v117=0;
  v118=false;
  v119=5126;
  v120=0;
  v121=0;
  v122=0;
  if(v16(v108)){
  v110=true;
  v116=v8.createStream(34962,v108);
  v119=v116.dtype;
  }
  else{
  v116=v8.getBuffer(v108);
  if(v116){
  v119=v116.dtype;
  }
  else if("constant" in v108){
  v111=2;
  if(typeof v108.constant === "number"){
  v112=v108.constant;
  v113=v114=v115=0;
  }
  else{
  v112=v108.constant.length>0?v108.constant[0]:0;
  v113=v108.constant.length>1?v108.constant[1]:0;
  v114=v108.constant.length>2?v108.constant[2]:0;
  v115=v108.constant.length>3?v108.constant[3]:0;
  }
  }
  else{
  if(v16(v108.buffer)){
  v116=v8.createStream(34962,v108.buffer);
  }
  else{
  v116=v8.getBuffer(v108.buffer);
  }
  v119="type" in v108?v49[v108.type]:v116.dtype;
  v118=!!v108.normalized;
  v117=v108.size|0;
  v120=v108.offset|0;
  v121=v108.stride|0;
  v122=v108.divisor|0;
  }
  }
  v124=g123.location;
  v125=v10[v124];
  if(v111===1){
  if(!v125.buffer){
  v1.enableVertexAttribArray(v124);
  }
  v126=v117||4;
  if(v125.type!==v119||v125.size!==v126||v125.buffer!==v116||v125.normalized!==v118||v125.offset!==v120||v125.stride!==v121){
  v1.bindBuffer(34962,v116.buffer);
  v1.vertexAttribPointer(v124,v126,v119,v118,v121,v120);
  v125.type=v119;
  v125.size=v126;
  v125.buffer=v116;
  v125.normalized=v118;
  v125.offset=v120;
  v125.stride=v121;
  }
  if(v125.divisor!==v122){
  v106.vertexAttribDivisorANGLE(v124,v122);
  v125.divisor=v122;
  }
  }
  else{
  if(v125.buffer){
  v1.disableVertexAttribArray(v124);
  v125.buffer=null;
  }
  if(v125.x!==v112||v125.y!==v113||v125.z!==v114||v125.w!==v115){
  v1.vertexAttrib4f(v124,v112,v113,v114,v115);
  v125.x=v112;
  v125.y=v113;
  v125.z=v114;
  v125.w=v115;
  }
  }
  v128=g127.call(this,v2,a0,0);
  if(!(v128&&(typeof v128==="object"||typeof v128==="function")&&(v16(v128)||v8.getBuffer(v128)||v8.getBuffer(v128.buffer)||v16(v128.buffer)||("constant" in v128&&(typeof v128.constant==="number"||v17(v128.constant))))))g18.commandRaise(g129,g19);
  v130=false;
  v131=1;
  v132=0;
  v133=0;
  v134=0;
  v135=0;
  v136=null;
  v137=0;
  v138=false;
  v139=5126;
  v140=0;
  v141=0;
  v142=0;
  if(v16(v128)){
  v130=true;
  v136=v8.createStream(34962,v128);
  v139=v136.dtype;
  }
  else{
  v136=v8.getBuffer(v128);
  if(v136){
  v139=v136.dtype;
  }
  else if("constant" in v128){
  v131=2;
  if(typeof v128.constant === "number"){
  v132=v128.constant;
  v133=v134=v135=0;
  }
  else{
  v132=v128.constant.length>0?v128.constant[0]:0;
  v133=v128.constant.length>1?v128.constant[1]:0;
  v134=v128.constant.length>2?v128.constant[2]:0;
  v135=v128.constant.length>3?v128.constant[3]:0;
  }
  }
  else{
  if(v16(v128.buffer)){
  v136=v8.createStream(34962,v128.buffer);
  }
  else{
  v136=v8.getBuffer(v128.buffer);
  }
  v139="type" in v128?v49[v128.type]:v136.dtype;
  v138=!!v128.normalized;
  v137=v128.size|0;
  v140=v128.offset|0;
  v141=v128.stride|0;
  v142=v128.divisor|0;
  }
  }
  v144=g143.location;
  v145=v10[v144];
  if(v131===1){
  if(!v145.buffer){
  v1.enableVertexAttribArray(v144);
  }
  v146=v137||1;
  if(v145.type!==v139||v145.size!==v146||v145.buffer!==v136||v145.normalized!==v138||v145.offset!==v140||v145.stride!==v141){
  v1.bindBuffer(34962,v136.buffer);
  v1.vertexAttribPointer(v144,v146,v139,v138,v141,v140);
  v145.type=v139;
  v145.size=v146;
  v145.buffer=v136;
  v145.normalized=v138;
  v145.offset=v140;
  v145.stride=v141;
  }
  if(v145.divisor!==v142){
  v106.vertexAttribDivisorANGLE(v144,v142);
  v145.divisor=v142;
  }
  }
  else{
  if(v145.buffer){
  v1.disableVertexAttribArray(v144);
  v145.buffer=null;
  }
  if(v145.x!==v132||v145.y!==v133||v145.z!==v134||v145.w!==v135){
  v1.vertexAttrib4f(v144,v132,v133,v134,v135);
  v145.x=v132;
  v145.y=v133;
  v145.z=v134;
  v145.w=v135;
  }
  }
  v148=g147.call(this,v2,a0,0);
  if(!(v148&&(typeof v148==="object"||typeof v148==="function")&&(v16(v148)||v8.getBuffer(v148)||v8.getBuffer(v148.buffer)||v16(v148.buffer)||("constant" in v148&&(typeof v148.constant==="number"||v17(v148.constant))))))g18.commandRaise(g149,g19);
  v150=false;
  v151=1;
  v152=0;
  v153=0;
  v154=0;
  v155=0;
  v156=null;
  v157=0;
  v158=false;
  v159=5126;
  v160=0;
  v161=0;
  v162=0;
  if(v16(v148)){
  v150=true;
  v156=v8.createStream(34962,v148);
  v159=v156.dtype;
  }
  else{
  v156=v8.getBuffer(v148);
  if(v156){
  v159=v156.dtype;
  }
  else if("constant" in v148){
  v151=2;
  if(typeof v148.constant === "number"){
  v152=v148.constant;
  v153=v154=v155=0;
  }
  else{
  v152=v148.constant.length>0?v148.constant[0]:0;
  v153=v148.constant.length>1?v148.constant[1]:0;
  v154=v148.constant.length>2?v148.constant[2]:0;
  v155=v148.constant.length>3?v148.constant[3]:0;
  }
  }
  else{
  if(v16(v148.buffer)){
  v156=v8.createStream(34962,v148.buffer);
  }
  else{
  v156=v8.getBuffer(v148.buffer);
  }
  v159="type" in v148?v49[v148.type]:v156.dtype;
  v158=!!v148.normalized;
  v157=v148.size|0;
  v160=v148.offset|0;
  v161=v148.stride|0;
  v162=v148.divisor|0;
  }
  }
  v164=g163.location;
  v165=v10[v164];
  if(v151===1){
  if(!v165.buffer){
  v1.enableVertexAttribArray(v164);
  }
  v166=v157||4;
  if(v165.type!==v159||v165.size!==v166||v165.buffer!==v156||v165.normalized!==v158||v165.offset!==v160||v165.stride!==v161){
  v1.bindBuffer(34962,v156.buffer);
  v1.vertexAttribPointer(v164,v166,v159,v158,v161,v160);
  v165.type=v159;
  v165.size=v166;
  v165.buffer=v156;
  v165.normalized=v158;
  v165.offset=v160;
  v165.stride=v161;
  }
  if(v165.divisor!==v162){
  v106.vertexAttribDivisorANGLE(v164,v162);
  v165.divisor=v162;
  }
  }
  else{
  if(v165.buffer){
  v1.disableVertexAttribArray(v164);
  v165.buffer=null;
  }
  if(v165.x!==v152||v165.y!==v153||v165.z!==v154||v165.w!==v155){
  v1.vertexAttrib4f(v164,v152,v153,v154,v155);
  v165.x=v152;
  v165.y=v153;
  v165.z=v154;
  v165.w=v155;
  }
  }
  v168=g167.call(this,v2,a0,0);
  if(!(v168&&(typeof v168==="object"||typeof v168==="function")&&(v16(v168)||v8.getBuffer(v168)||v8.getBuffer(v168.buffer)||v16(v168.buffer)||("constant" in v168&&(typeof v168.constant==="number"||v17(v168.constant))))))g18.commandRaise(g169,g19);
  v170=false;
  v171=1;
  v172=0;
  v173=0;
  v174=0;
  v175=0;
  v176=null;
  v177=0;
  v178=false;
  v179=5126;
  v180=0;
  v181=0;
  v182=0;
  if(v16(v168)){
  v170=true;
  v176=v8.createStream(34962,v168);
  v179=v176.dtype;
  }
  else{
  v176=v8.getBuffer(v168);
  if(v176){
  v179=v176.dtype;
  }
  else if("constant" in v168){
  v171=2;
  if(typeof v168.constant === "number"){
  v172=v168.constant;
  v173=v174=v175=0;
  }
  else{
  v172=v168.constant.length>0?v168.constant[0]:0;
  v173=v168.constant.length>1?v168.constant[1]:0;
  v174=v168.constant.length>2?v168.constant[2]:0;
  v175=v168.constant.length>3?v168.constant[3]:0;
  }
  }
  else{
  if(v16(v168.buffer)){
  v176=v8.createStream(34962,v168.buffer);
  }
  else{
  v176=v8.getBuffer(v168.buffer);
  }
  v179="type" in v168?v49[v168.type]:v176.dtype;
  v178=!!v168.normalized;
  v177=v168.size|0;
  v180=v168.offset|0;
  v181=v168.stride|0;
  v182=v168.divisor|0;
  }
  }
  v184=g183.location;
  v185=v10[v184];
  if(v171===1){
  if(!v185.buffer){
  v1.enableVertexAttribArray(v184);
  }
  v186=v177||1;
  if(v185.type!==v179||v185.size!==v186||v185.buffer!==v176||v185.normalized!==v178||v185.offset!==v180||v185.stride!==v181){
  v1.bindBuffer(34962,v176.buffer);
  v1.vertexAttribPointer(v184,v186,v179,v178,v181,v180);
  v185.type=v179;
  v185.size=v186;
  v185.buffer=v176;
  v185.normalized=v178;
  v185.offset=v180;
  v185.stride=v181;
  }
  if(v185.divisor!==v182){
  v106.vertexAttribDivisorANGLE(v184,v182);
  v185.divisor=v182;
  }
  }
  else{
  if(v185.buffer){
  v1.disableVertexAttribArray(v184);
  v185.buffer=null;
  }
  if(v185.x!==v172||v185.y!==v173||v185.z!==v174||v185.w!==v175){
  v1.vertexAttrib4f(v184,v172,v173,v174,v175);
  v185.x=v172;
  v185.y=v173;
  v185.z=v174;
  v185.w=v175;
  }
  }
  v188=g187.call(this,v2,a0,0);
  if(!(v188&&(typeof v188==="object"||typeof v188==="function")&&(v16(v188)||v8.getBuffer(v188)||v8.getBuffer(v188.buffer)||v16(v188.buffer)||("constant" in v188&&(typeof v188.constant==="number"||v17(v188.constant))))))g18.commandRaise(g189,g19);
  v190=false;
  v191=1;
  v192=0;
  v193=0;
  v194=0;
  v195=0;
  v196=null;
  v197=0;
  v198=false;
  v199=5126;
  v200=0;
  v201=0;
  v202=0;
  if(v16(v188)){
  v190=true;
  v196=v8.createStream(34962,v188);
  v199=v196.dtype;
  }
  else{
  v196=v8.getBuffer(v188);
  if(v196){
  v199=v196.dtype;
  }
  else if("constant" in v188){
  v191=2;
  if(typeof v188.constant === "number"){
  v192=v188.constant;
  v193=v194=v195=0;
  }
  else{
  v192=v188.constant.length>0?v188.constant[0]:0;
  v193=v188.constant.length>1?v188.constant[1]:0;
  v194=v188.constant.length>2?v188.constant[2]:0;
  v195=v188.constant.length>3?v188.constant[3]:0;
  }
  }
  else{
  if(v16(v188.buffer)){
  v196=v8.createStream(34962,v188.buffer);
  }
  else{
  v196=v8.getBuffer(v188.buffer);
  }
  v199="type" in v188?v49[v188.type]:v196.dtype;
  v198=!!v188.normalized;
  v197=v188.size|0;
  v200=v188.offset|0;
  v201=v188.stride|0;
  v202=v188.divisor|0;
  }
  }
  v204=g203.location;
  v205=v10[v204];
  if(v191===1){
  if(!v205.buffer){
  v1.enableVertexAttribArray(v204);
  }
  v206=v197||1;
  if(v205.type!==v199||v205.size!==v206||v205.buffer!==v196||v205.normalized!==v198||v205.offset!==v200||v205.stride!==v201){
  v1.bindBuffer(34962,v196.buffer);
  v1.vertexAttribPointer(v204,v206,v199,v198,v201,v200);
  v205.type=v199;
  v205.size=v206;
  v205.buffer=v196;
  v205.normalized=v198;
  v205.offset=v200;
  v205.stride=v201;
  }
  if(v205.divisor!==v202){
  v106.vertexAttribDivisorANGLE(v204,v202);
  v205.divisor=v202;
  }
  }
  else{
  if(v205.buffer){
  v1.disableVertexAttribArray(v204);
  v205.buffer=null;
  }
  if(v205.x!==v192||v205.y!==v193||v205.z!==v194||v205.w!==v195){
  v1.vertexAttrib4f(v204,v192,v193,v194,v195);
  v205.x=v192;
  v205.y=v193;
  v205.z=v194;
  v205.w=v195;
  }
  }
  v208=g207.call(this,v2,a0,0);
  if(!(v208&&(typeof v208==="object"||typeof v208==="function")&&(v16(v208)||v8.getBuffer(v208)||v8.getBuffer(v208.buffer)||v16(v208.buffer)||("constant" in v208&&(typeof v208.constant==="number"||v17(v208.constant))))))g18.commandRaise(g209,g19);
  v210=false;
  v211=1;
  v212=0;
  v213=0;
  v214=0;
  v215=0;
  v216=null;
  v217=0;
  v218=false;
  v219=5126;
  v220=0;
  v221=0;
  v222=0;
  if(v16(v208)){
  v210=true;
  v216=v8.createStream(34962,v208);
  v219=v216.dtype;
  }
  else{
  v216=v8.getBuffer(v208);
  if(v216){
  v219=v216.dtype;
  }
  else if("constant" in v208){
  v211=2;
  if(typeof v208.constant === "number"){
  v212=v208.constant;
  v213=v214=v215=0;
  }
  else{
  v212=v208.constant.length>0?v208.constant[0]:0;
  v213=v208.constant.length>1?v208.constant[1]:0;
  v214=v208.constant.length>2?v208.constant[2]:0;
  v215=v208.constant.length>3?v208.constant[3]:0;
  }
  }
  else{
  if(v16(v208.buffer)){
  v216=v8.createStream(34962,v208.buffer);
  }
  else{
  v216=v8.getBuffer(v208.buffer);
  }
  v219="type" in v208?v49[v208.type]:v216.dtype;
  v218=!!v208.normalized;
  v217=v208.size|0;
  v220=v208.offset|0;
  v221=v208.stride|0;
  v222=v208.divisor|0;
  }
  }
  v224=g223.location;
  v225=v10[v224];
  if(v211===1){
  if(!v225.buffer){
  v1.enableVertexAttribArray(v224);
  }
  v226=v217||1;
  if(v225.type!==v219||v225.size!==v226||v225.buffer!==v216||v225.normalized!==v218||v225.offset!==v220||v225.stride!==v221){
  v1.bindBuffer(34962,v216.buffer);
  v1.vertexAttribPointer(v224,v226,v219,v218,v221,v220);
  v225.type=v219;
  v225.size=v226;
  v225.buffer=v216;
  v225.normalized=v218;
  v225.offset=v220;
  v225.stride=v221;
  }
  if(v225.divisor!==v222){
  v106.vertexAttribDivisorANGLE(v224,v222);
  v225.divisor=v222;
  }
  }
  else{
  if(v225.buffer){
  v1.disableVertexAttribArray(v224);
  v225.buffer=null;
  }
  if(v225.x!==v212||v225.y!==v213||v225.z!==v214||v225.w!==v215){
  v1.vertexAttrib4f(v224,v212,v213,v214,v215);
  v225.x=v212;
  v225.y=v213;
  v225.z=v214;
  v225.w=v215;
  }
  }
  v228=g227.call(this,v2,a0,0);
  if(!(v228&&(typeof v228==="object"||typeof v228==="function")&&(v16(v228)||v8.getBuffer(v228)||v8.getBuffer(v228.buffer)||v16(v228.buffer)||("constant" in v228&&(typeof v228.constant==="number"||v17(v228.constant))))))g18.commandRaise(g229,g19);
  v230=false;
  v231=1;
  v232=0;
  v233=0;
  v234=0;
  v235=0;
  v236=null;
  v237=0;
  v238=false;
  v239=5126;
  v240=0;
  v241=0;
  v242=0;
  if(v16(v228)){
  v230=true;
  v236=v8.createStream(34962,v228);
  v239=v236.dtype;
  }
  else{
  v236=v8.getBuffer(v228);
  if(v236){
  v239=v236.dtype;
  }
  else if("constant" in v228){
  v231=2;
  if(typeof v228.constant === "number"){
  v232=v228.constant;
  v233=v234=v235=0;
  }
  else{
  v232=v228.constant.length>0?v228.constant[0]:0;
  v233=v228.constant.length>1?v228.constant[1]:0;
  v234=v228.constant.length>2?v228.constant[2]:0;
  v235=v228.constant.length>3?v228.constant[3]:0;
  }
  }
  else{
  if(v16(v228.buffer)){
  v236=v8.createStream(34962,v228.buffer);
  }
  else{
  v236=v8.getBuffer(v228.buffer);
  }
  v239="type" in v228?v49[v228.type]:v236.dtype;
  v238=!!v228.normalized;
  v237=v228.size|0;
  v240=v228.offset|0;
  v241=v228.stride|0;
  v242=v228.divisor|0;
  }
  }
  v244=g243.location;
  v245=v10[v244];
  if(v231===1){
  if(!v245.buffer){
  v1.enableVertexAttribArray(v244);
  }
  v246=v237||1;
  if(v245.type!==v239||v245.size!==v246||v245.buffer!==v236||v245.normalized!==v238||v245.offset!==v240||v245.stride!==v241){
  v1.bindBuffer(34962,v236.buffer);
  v1.vertexAttribPointer(v244,v246,v239,v238,v241,v240);
  v245.type=v239;
  v245.size=v246;
  v245.buffer=v236;
  v245.normalized=v238;
  v245.offset=v240;
  v245.stride=v241;
  }
  if(v245.divisor!==v242){
  v106.vertexAttribDivisorANGLE(v244,v242);
  v245.divisor=v242;
  }
  }
  else{
  if(v245.buffer){
  v1.disableVertexAttribArray(v244);
  v245.buffer=null;
  }
  if(v245.x!==v232||v245.y!==v233||v245.z!==v234||v245.w!==v235){
  v1.vertexAttrib4f(v244,v232,v233,v234,v235);
  v245.x=v232;
  v245.y=v233;
  v245.z=v234;
  v245.w=v235;
  }
  }
  v248=g247.call(this,v2,a0,0);
  if(!(v248&&(typeof v248==="object"||typeof v248==="function")&&(v16(v248)||v8.getBuffer(v248)||v8.getBuffer(v248.buffer)||v16(v248.buffer)||("constant" in v248&&(typeof v248.constant==="number"||v17(v248.constant))))))g18.commandRaise(g249,g19);
  v250=false;
  v251=1;
  v252=0;
  v253=0;
  v254=0;
  v255=0;
  v256=null;
  v257=0;
  v258=false;
  v259=5126;
  v260=0;
  v261=0;
  v262=0;
  if(v16(v248)){
  v250=true;
  v256=v8.createStream(34962,v248);
  v259=v256.dtype;
  }
  else{
  v256=v8.getBuffer(v248);
  if(v256){
  v259=v256.dtype;
  }
  else if("constant" in v248){
  v251=2;
  if(typeof v248.constant === "number"){
  v252=v248.constant;
  v253=v254=v255=0;
  }
  else{
  v252=v248.constant.length>0?v248.constant[0]:0;
  v253=v248.constant.length>1?v248.constant[1]:0;
  v254=v248.constant.length>2?v248.constant[2]:0;
  v255=v248.constant.length>3?v248.constant[3]:0;
  }
  }
  else{
  if(v16(v248.buffer)){
  v256=v8.createStream(34962,v248.buffer);
  }
  else{
  v256=v8.getBuffer(v248.buffer);
  }
  v259="type" in v248?v49[v248.type]:v256.dtype;
  v258=!!v248.normalized;
  v257=v248.size|0;
  v260=v248.offset|0;
  v261=v248.stride|0;
  v262=v248.divisor|0;
  }
  }
  v264=g263.location;
  v265=v10[v264];
  if(v251===1){
  if(!v265.buffer){
  v1.enableVertexAttribArray(v264);
  }
  v266=v257||1;
  if(v265.type!==v259||v265.size!==v266||v265.buffer!==v256||v265.normalized!==v258||v265.offset!==v260||v265.stride!==v261){
  v1.bindBuffer(34962,v256.buffer);
  v1.vertexAttribPointer(v264,v266,v259,v258,v261,v260);
  v265.type=v259;
  v265.size=v266;
  v265.buffer=v256;
  v265.normalized=v258;
  v265.offset=v260;
  v265.stride=v261;
  }
  if(v265.divisor!==v262){
  v106.vertexAttribDivisorANGLE(v264,v262);
  v265.divisor=v262;
  }
  }
  else{
  if(v265.buffer){
  v1.disableVertexAttribArray(v264);
  v265.buffer=null;
  }
  if(v265.x!==v252||v265.y!==v253||v265.z!==v254||v265.w!==v255){
  v1.vertexAttrib4f(v264,v252,v253,v254,v255);
  v265.x=v252;
  v265.y=v253;
  v265.z=v254;
  v265.w=v255;
  }
  }
  v268=g267.call(this,v2,a0,0);
  if(!(v268&&(typeof v268==="object"||typeof v268==="function")&&(v16(v268)||v8.getBuffer(v268)||v8.getBuffer(v268.buffer)||v16(v268.buffer)||("constant" in v268&&(typeof v268.constant==="number"||v17(v268.constant))))))g18.commandRaise(g269,g19);
  v270=false;
  v271=1;
  v272=0;
  v273=0;
  v274=0;
  v275=0;
  v276=null;
  v277=0;
  v278=false;
  v279=5126;
  v280=0;
  v281=0;
  v282=0;
  if(v16(v268)){
  v270=true;
  v276=v8.createStream(34962,v268);
  v279=v276.dtype;
  }
  else{
  v276=v8.getBuffer(v268);
  if(v276){
  v279=v276.dtype;
  }
  else if("constant" in v268){
  v271=2;
  if(typeof v268.constant === "number"){
  v272=v268.constant;
  v273=v274=v275=0;
  }
  else{
  v272=v268.constant.length>0?v268.constant[0]:0;
  v273=v268.constant.length>1?v268.constant[1]:0;
  v274=v268.constant.length>2?v268.constant[2]:0;
  v275=v268.constant.length>3?v268.constant[3]:0;
  }
  }
  else{
  if(v16(v268.buffer)){
  v276=v8.createStream(34962,v268.buffer);
  }
  else{
  v276=v8.getBuffer(v268.buffer);
  }
  v279="type" in v268?v49[v268.type]:v276.dtype;
  v278=!!v268.normalized;
  v277=v268.size|0;
  v280=v268.offset|0;
  v281=v268.stride|0;
  v282=v268.divisor|0;
  }
  }
  v284=g283.location;
  v285=v10[v284];
  if(v271===1){
  if(!v285.buffer){
  v1.enableVertexAttribArray(v284);
  }
  v286=v277||1;
  if(v285.type!==v279||v285.size!==v286||v285.buffer!==v276||v285.normalized!==v278||v285.offset!==v280||v285.stride!==v281){
  v1.bindBuffer(34962,v276.buffer);
  v1.vertexAttribPointer(v284,v286,v279,v278,v281,v280);
  v285.type=v279;
  v285.size=v286;
  v285.buffer=v276;
  v285.normalized=v278;
  v285.offset=v280;
  v285.stride=v281;
  }
  if(v285.divisor!==v282){
  v106.vertexAttribDivisorANGLE(v284,v282);
  v285.divisor=v282;
  }
  }
  else{
  if(v285.buffer){
  v1.disableVertexAttribArray(v284);
  v285.buffer=null;
  }
  if(v285.x!==v272||v285.y!==v273||v285.z!==v274||v285.w!==v275){
  v1.vertexAttrib4f(v284,v272,v273,v274,v275);
  v285.x=v272;
  v285.y=v273;
  v285.z=v274;
  v285.w=v275;
  }
  }
  v1.uniform1i(g287.location,false);
  v289=a0["opacity"];
  if(!(typeof v289==="number"))g18.commandRaise(g290,g19);
  v1.uniform1f(g288.location,v289);
  v293=g292.call(this,v2,a0,0);
  if(!(v17(v293)&&v293.length===2))g18.commandRaise(g294,g19);
  v295=v293[0];
  v296=v293[1];
  v1.uniform2f(g291.location,v295,v296);
  v1.uniform1i(g297.location,g298.bind());
  v300=v2["pixelRatio"];
  if(!(typeof v300==="number"))g18.commandRaise(g301,g19);
  v1.uniform1f(g299.location,v300);
  v303=a0["scale"];
  if(!(v17(v303)&&v303.length===2))g18.commandRaise(g304,g19);
  v305=v303[0];
  v306=v303[1];
  v1.uniform2f(g302.location,v305,v306);
  v308=a0["scaleFract"];
  if(!(v17(v308)&&v308.length===2))g18.commandRaise(g309,g19);
  v310=v308[0];
  v311=v308[1];
  v1.uniform2f(g307.location,v310,v311);
  v313=a0["translate"];
  if(!(v17(v313)&&v313.length===2))g18.commandRaise(g314,g19);
  v315=v313[0];
  v316=v313[1];
  v1.uniform2f(g312.location,v315,v316);
  v318=a0["translateFract"];
  if(!(v17(v318)&&v318.length===2))g18.commandRaise(g319,g19);
  v320=v318[0];
  v321=v318[1];
  v1.uniform2f(g317.location,v320,v321);
  v322=a0["elements"];
  v323=null;
  v324=v16(v322);
  if(v324){
  v323=v7.createStream(v322);
  }
  else{
  v323=v7.getElements(v322);
  if(!(!v322||v323))g18.commandRaise(g325,g19);
  }
  if(v323)v1.bindBuffer(34963,v323.buffer.buffer);
  v326=a0["offset"];
  if(!(v326>=0))g18.commandRaise(g327,g19);
  v328=a0["count"];
  if(!(typeof v328==="number"&&v328>=0&&v328===(v328|0)))g18.commandRaise(g329,g19);
  if(v328){
  v330=v6.instances;
  if(v330>0){
  if(v323){
  v106.drawElementsInstancedANGLE(0,v328,v323.type,v326<<((v323.type-5121)>>1),v330);
  }
  else{
  v106.drawArraysInstancedANGLE(0,v326,v328,v330);
  }
  }
  else if(v330<0){
  if(v323){
  v1.drawElements(0,v328,v323.type,v326<<((v323.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v326,v328);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v95;
  v2.viewportHeight=v96;
  if(v103){
  g52.cpuTime+=performance.now()-v104;
  }
  if(v110){
  v8.destroyStream(v116);
  }
  if(v130){
  v8.destroyStream(v136);
  }
  if(v150){
  v8.destroyStream(v156);
  }
  if(v170){
  v8.destroyStream(v176);
  }
  if(v190){
  v8.destroyStream(v196);
  }
  if(v210){
  v8.destroyStream(v216);
  }
  if(v230){
  v8.destroyStream(v236);
  }
  if(v250){
  v8.destroyStream(v256);
  }
  if(v270){
  v8.destroyStream(v276);
  }
  g298.unbind();
  if(v324){
  v7.destroyStream(v323);
  }
  }
  }
  ,"scope":function(a0,a1,a2){
  var v331,v332,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v348,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v376,v377,v378,v379,v380,v381,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v403,v404,v405,v406,v408,v409,v410,v411,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v435,v436,v437,v438,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v449,v450,v451,v452,v453,v454,v455,v456,v457,v458,v459,v460,v462,v463,v464,v465,v466,v467,v468,v469,v470,v471,v472,v473,v474,v475,v476,v477,v478,v479,v480,v481,v482,v483,v484,v485,v486,v487,v489,v490,v491,v492,v493,v494,v495,v496,v497,v498,v499,v500,v501,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v514,v516,v517,v518,v519,v520,v521,v522,v523,v524,v525,v526,v527,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537,v538,v539,v540,v541,v543,v544,v545,v546,v547,v548,v549,v550,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v570,v571,v572,v573,v574,v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v586,v587,v588,v589,v590,v591,v592,v593,v594,v595,v597,v598,v599,v600,v601,v602,v603,v604,v605,v606,v607,v608,v609,v610,v611,v612,v613,v614,v615,v616,v617,v618,v619,v620,v621,v622,v624,v625,v626,v627,v628,v629,v630,v631,v632,v633,v634,v635,v636,v637;
  v331=a0["viewport"];
  if(!(v331&&typeof v331==="object"))g18.commandRaise(g90,g19);
  v332=v331.x|0;
  v333=v331.y|0;
  v334="width" in v331?v331.width|0:(v2.framebufferWidth-v332);
  v335="height" in v331?v331.height|0:(v2.framebufferHeight-v333);
  if(!(v334>=0&&v335>=0))g18.commandRaise(g90,g19);
  v336=v2.viewportWidth;
  v2.viewportWidth=v334;
  v337=v2.viewportHeight;
  v2.viewportHeight=v335;
  v338=v42[0];
  v42[0]=_gs[8];
  v339=v42[1];
  v42[1]=_gs[9];
  v340=v42[2];
  v42[2]=_gs[10];
  v341=v42[3];
  v42[3]=_gs[11];
  v342=v20[0];
  v20[0]=_gs[12];
  v343=v20[1];
  v20[1]=_gs[13];
  v344=v20[2];
  v20[2]=_gs[14];
  v345=v20[3];
  v20[3]=_gs[15];
  v346=v4.blend_enable;
  v4.blend_enable=_gs[16];
  v347=v24[0];
  v24[0]=_gs[17];
  v348=v24[1];
  v24[1]=_gs[18];
  v349=v24[2];
  v24[2]=_gs[19];
  v350=v24[3];
  v24[3]=_gs[20];
  v351=v4.depth_enable;
  v4.depth_enable=_gs[21];
  v352=a0["viewport"];
  if(!(v352&&typeof v352==="object"))g18.commandRaise(g98,g19);
  v353=v352.x|0;
  v354=v352.y|0;
  v355="width" in v352?v352.width|0:(v2.framebufferWidth-v353);
  v356="height" in v352?v352.height|0:(v2.framebufferHeight-v354);
  if(!(v355>=0&&v356>=0))g18.commandRaise(g98,g19);
  v357=v40[0];
  v40[0]=_gs[22];
  v358=v40[1];
  v40[1]=_gs[23];
  v359=v40[2];
  v40[2]=_gs[24];
  v360=v40[3];
  v40[3]=_gs[25];
  v361=v4.scissor_enable;
  v4.scissor_enable=_gs[26];
  v362=v4.stencil_enable;
  v4.stencil_enable=_gs[27];
  v363=v5.profile;
  if(v363){
  v364=performance.now();
  g52.count++;
  }
  v365=a0["elements"];
  v366=null;
  v367=v16(v365);
  if(v367){
  v366=v7.createStream(v365);
  }
  else{
  v366=v7.getElements(v365);
  if(!(!v365||v366))g18.commandRaise(g325,g19);
  }
  v368=v6.elements;
  v6.elements=_gs[28];
  v369=a0["offset"];
  if(!(v369>=0))g18.commandRaise(g327,g19);
  v370=v6.offset;
  v6.offset=_gs[29];
  v371=a0["count"];
  if(!(typeof v371==="number"&&v371>=0&&v371===(v371|0)))g18.commandRaise(g329,g19);
  v372=v6.count;
  v6.count=_gs[30];
  v373=v6.primitive;
  v6.primitive=_gs[31];
  v374=v12[_gs[32]];
  v12[_gs[32]]=false;
  v376=v12[_gs[33]];
  v12[_gs[33]]=g375;
  v377=a0["opacity"];
  v378=v12[_gs[34]];
  v12[_gs[34]]=v377;
  v379=g292.call(this,v2,a0,a2);
  v380=v12[_gs[35]];
  v12[_gs[35]]=v379;
  v381=v2["pixelRatio"];
  v382=v12[_gs[36]];
  v12[_gs[36]]=v381;
  v383=a0["scale"];
  v384=v12[_gs[37]];
  v12[_gs[37]]=v383;
  v385=a0["scaleFract"];
  v386=v12[_gs[38]];
  v12[_gs[38]]=v385;
  v387=a0["translate"];
  v388=v12[_gs[39]];
  v12[_gs[39]]=v387;
  v389=a0["translateFract"];
  v390=v12[_gs[40]];
  v12[_gs[40]]=v389;
  v391=a0["markerTexture"];
  v392=v12[_gs[41]];
  v12[_gs[41]]=v391;
  v393=g207.call(this,v2,a0,a2);
  if(!(v393&&(typeof v393==="object"||typeof v393==="function")&&(v16(v393)||v8.getBuffer(v393)||v8.getBuffer(v393.buffer)||v16(v393.buffer)||("constant" in v393&&(typeof v393.constant==="number"||v17(v393.constant))))))g18.commandRaise(g209,g19);
  v394=false;
  v395=1;
  v396=0;
  v397=0;
  v398=0;
  v399=0;
  v400=null;
  v401=0;
  v402=false;
  v403=5126;
  v404=0;
  v405=0;
  v406=0;
  if(v16(v393)){
  v394=true;
  v400=v8.createStream(34962,v393);
  v403=v400.dtype;
  }
  else{
  v400=v8.getBuffer(v393);
  if(v400){
  v403=v400.dtype;
  }
  else if("constant" in v393){
  v395=2;
  if(typeof v393.constant === "number"){
  v396=v393.constant;
  v397=v398=v399=0;
  }
  else{
  v396=v393.constant.length>0?v393.constant[0]:0;
  v397=v393.constant.length>1?v393.constant[1]:0;
  v398=v393.constant.length>2?v393.constant[2]:0;
  v399=v393.constant.length>3?v393.constant[3]:0;
  }
  }
  else{
  if(v16(v393.buffer)){
  v400=v8.createStream(34962,v393.buffer);
  }
  else{
  v400=v8.getBuffer(v393.buffer);
  }
  v403="type" in v393?v49[v393.type]:v400.dtype;
  v402=!!v393.normalized;
  v401=v393.size|0;
  v404=v393.offset|0;
  v405=v393.stride|0;
  v406=v393.divisor|0;
  }
  }
  v408=g407.state;
  g407.state=v395;
  v409=g407.x;
  g407.x=v396;
  v410=g407.y;
  g407.y=v397;
  v411=g407.z;
  g407.z=v398;
  v412=g407.w;
  g407.w=v399;
  v413=g407.buffer;
  g407.buffer=v400;
  v414=g407.size;
  g407.size=v401;
  v415=g407.normalized;
  g407.normalized=v402;
  v416=g407.type;
  g407.type=v403;
  v417=g407.offset;
  g407.offset=v404;
  v418=g407.stride;
  g407.stride=v405;
  v419=g407.divisor;
  g407.divisor=v406;
  v420=g247.call(this,v2,a0,a2);
  if(!(v420&&(typeof v420==="object"||typeof v420==="function")&&(v16(v420)||v8.getBuffer(v420)||v8.getBuffer(v420.buffer)||v16(v420.buffer)||("constant" in v420&&(typeof v420.constant==="number"||v17(v420.constant))))))g18.commandRaise(g249,g19);
  v421=false;
  v422=1;
  v423=0;
  v424=0;
  v425=0;
  v426=0;
  v427=null;
  v428=0;
  v429=false;
  v430=5126;
  v431=0;
  v432=0;
  v433=0;
  if(v16(v420)){
  v421=true;
  v427=v8.createStream(34962,v420);
  v430=v427.dtype;
  }
  else{
  v427=v8.getBuffer(v420);
  if(v427){
  v430=v427.dtype;
  }
  else if("constant" in v420){
  v422=2;
  if(typeof v420.constant === "number"){
  v423=v420.constant;
  v424=v425=v426=0;
  }
  else{
  v423=v420.constant.length>0?v420.constant[0]:0;
  v424=v420.constant.length>1?v420.constant[1]:0;
  v425=v420.constant.length>2?v420.constant[2]:0;
  v426=v420.constant.length>3?v420.constant[3]:0;
  }
  }
  else{
  if(v16(v420.buffer)){
  v427=v8.createStream(34962,v420.buffer);
  }
  else{
  v427=v8.getBuffer(v420.buffer);
  }
  v430="type" in v420?v49[v420.type]:v427.dtype;
  v429=!!v420.normalized;
  v428=v420.size|0;
  v431=v420.offset|0;
  v432=v420.stride|0;
  v433=v420.divisor|0;
  }
  }
  v435=g434.state;
  g434.state=v422;
  v436=g434.x;
  g434.x=v423;
  v437=g434.y;
  g434.y=v424;
  v438=g434.z;
  g434.z=v425;
  v439=g434.w;
  g434.w=v426;
  v440=g434.buffer;
  g434.buffer=v427;
  v441=g434.size;
  g434.size=v428;
  v442=g434.normalized;
  g434.normalized=v429;
  v443=g434.type;
  g434.type=v430;
  v444=g434.offset;
  g434.offset=v431;
  v445=g434.stride;
  g434.stride=v432;
  v446=g434.divisor;
  g434.divisor=v433;
  v447=g227.call(this,v2,a0,a2);
  if(!(v447&&(typeof v447==="object"||typeof v447==="function")&&(v16(v447)||v8.getBuffer(v447)||v8.getBuffer(v447.buffer)||v16(v447.buffer)||("constant" in v447&&(typeof v447.constant==="number"||v17(v447.constant))))))g18.commandRaise(g229,g19);
  v448=false;
  v449=1;
  v450=0;
  v451=0;
  v452=0;
  v453=0;
  v454=null;
  v455=0;
  v456=false;
  v457=5126;
  v458=0;
  v459=0;
  v460=0;
  if(v16(v447)){
  v448=true;
  v454=v8.createStream(34962,v447);
  v457=v454.dtype;
  }
  else{
  v454=v8.getBuffer(v447);
  if(v454){
  v457=v454.dtype;
  }
  else if("constant" in v447){
  v449=2;
  if(typeof v447.constant === "number"){
  v450=v447.constant;
  v451=v452=v453=0;
  }
  else{
  v450=v447.constant.length>0?v447.constant[0]:0;
  v451=v447.constant.length>1?v447.constant[1]:0;
  v452=v447.constant.length>2?v447.constant[2]:0;
  v453=v447.constant.length>3?v447.constant[3]:0;
  }
  }
  else{
  if(v16(v447.buffer)){
  v454=v8.createStream(34962,v447.buffer);
  }
  else{
  v454=v8.getBuffer(v447.buffer);
  }
  v457="type" in v447?v49[v447.type]:v454.dtype;
  v456=!!v447.normalized;
  v455=v447.size|0;
  v458=v447.offset|0;
  v459=v447.stride|0;
  v460=v447.divisor|0;
  }
  }
  v462=g461.state;
  g461.state=v449;
  v463=g461.x;
  g461.x=v450;
  v464=g461.y;
  g461.y=v451;
  v465=g461.z;
  g461.z=v452;
  v466=g461.w;
  g461.w=v453;
  v467=g461.buffer;
  g461.buffer=v454;
  v468=g461.size;
  g461.size=v455;
  v469=g461.normalized;
  g461.normalized=v456;
  v470=g461.type;
  g461.type=v457;
  v471=g461.offset;
  g461.offset=v458;
  v472=g461.stride;
  g461.stride=v459;
  v473=g461.divisor;
  g461.divisor=v460;
  v474=g267.call(this,v2,a0,a2);
  if(!(v474&&(typeof v474==="object"||typeof v474==="function")&&(v16(v474)||v8.getBuffer(v474)||v8.getBuffer(v474.buffer)||v16(v474.buffer)||("constant" in v474&&(typeof v474.constant==="number"||v17(v474.constant))))))g18.commandRaise(g269,g19);
  v475=false;
  v476=1;
  v477=0;
  v478=0;
  v479=0;
  v480=0;
  v481=null;
  v482=0;
  v483=false;
  v484=5126;
  v485=0;
  v486=0;
  v487=0;
  if(v16(v474)){
  v475=true;
  v481=v8.createStream(34962,v474);
  v484=v481.dtype;
  }
  else{
  v481=v8.getBuffer(v474);
  if(v481){
  v484=v481.dtype;
  }
  else if("constant" in v474){
  v476=2;
  if(typeof v474.constant === "number"){
  v477=v474.constant;
  v478=v479=v480=0;
  }
  else{
  v477=v474.constant.length>0?v474.constant[0]:0;
  v478=v474.constant.length>1?v474.constant[1]:0;
  v479=v474.constant.length>2?v474.constant[2]:0;
  v480=v474.constant.length>3?v474.constant[3]:0;
  }
  }
  else{
  if(v16(v474.buffer)){
  v481=v8.createStream(34962,v474.buffer);
  }
  else{
  v481=v8.getBuffer(v474.buffer);
  }
  v484="type" in v474?v49[v474.type]:v481.dtype;
  v483=!!v474.normalized;
  v482=v474.size|0;
  v485=v474.offset|0;
  v486=v474.stride|0;
  v487=v474.divisor|0;
  }
  }
  v489=g488.state;
  g488.state=v476;
  v490=g488.x;
  g488.x=v477;
  v491=g488.y;
  g488.y=v478;
  v492=g488.z;
  g488.z=v479;
  v493=g488.w;
  g488.w=v480;
  v494=g488.buffer;
  g488.buffer=v481;
  v495=g488.size;
  g488.size=v482;
  v496=g488.normalized;
  g488.normalized=v483;
  v497=g488.type;
  g488.type=v484;
  v498=g488.offset;
  g488.offset=v485;
  v499=g488.stride;
  g488.stride=v486;
  v500=g488.divisor;
  g488.divisor=v487;
  v501=g187.call(this,v2,a0,a2);
  if(!(v501&&(typeof v501==="object"||typeof v501==="function")&&(v16(v501)||v8.getBuffer(v501)||v8.getBuffer(v501.buffer)||v16(v501.buffer)||("constant" in v501&&(typeof v501.constant==="number"||v17(v501.constant))))))g18.commandRaise(g189,g19);
  v502=false;
  v503=1;
  v504=0;
  v505=0;
  v506=0;
  v507=0;
  v508=null;
  v509=0;
  v510=false;
  v511=5126;
  v512=0;
  v513=0;
  v514=0;
  if(v16(v501)){
  v502=true;
  v508=v8.createStream(34962,v501);
  v511=v508.dtype;
  }
  else{
  v508=v8.getBuffer(v501);
  if(v508){
  v511=v508.dtype;
  }
  else if("constant" in v501){
  v503=2;
  if(typeof v501.constant === "number"){
  v504=v501.constant;
  v505=v506=v507=0;
  }
  else{
  v504=v501.constant.length>0?v501.constant[0]:0;
  v505=v501.constant.length>1?v501.constant[1]:0;
  v506=v501.constant.length>2?v501.constant[2]:0;
  v507=v501.constant.length>3?v501.constant[3]:0;
  }
  }
  else{
  if(v16(v501.buffer)){
  v508=v8.createStream(34962,v501.buffer);
  }
  else{
  v508=v8.getBuffer(v501.buffer);
  }
  v511="type" in v501?v49[v501.type]:v508.dtype;
  v510=!!v501.normalized;
  v509=v501.size|0;
  v512=v501.offset|0;
  v513=v501.stride|0;
  v514=v501.divisor|0;
  }
  }
  v516=g515.state;
  g515.state=v503;
  v517=g515.x;
  g515.x=v504;
  v518=g515.y;
  g515.y=v505;
  v519=g515.z;
  g515.z=v506;
  v520=g515.w;
  g515.w=v507;
  v521=g515.buffer;
  g515.buffer=v508;
  v522=g515.size;
  g515.size=v509;
  v523=g515.normalized;
  g515.normalized=v510;
  v524=g515.type;
  g515.type=v511;
  v525=g515.offset;
  g515.offset=v512;
  v526=g515.stride;
  g515.stride=v513;
  v527=g515.divisor;
  g515.divisor=v514;
  v528=g127.call(this,v2,a0,a2);
  if(!(v528&&(typeof v528==="object"||typeof v528==="function")&&(v16(v528)||v8.getBuffer(v528)||v8.getBuffer(v528.buffer)||v16(v528.buffer)||("constant" in v528&&(typeof v528.constant==="number"||v17(v528.constant))))))g18.commandRaise(g129,g19);
  v529=false;
  v530=1;
  v531=0;
  v532=0;
  v533=0;
  v534=0;
  v535=null;
  v536=0;
  v537=false;
  v538=5126;
  v539=0;
  v540=0;
  v541=0;
  if(v16(v528)){
  v529=true;
  v535=v8.createStream(34962,v528);
  v538=v535.dtype;
  }
  else{
  v535=v8.getBuffer(v528);
  if(v535){
  v538=v535.dtype;
  }
  else if("constant" in v528){
  v530=2;
  if(typeof v528.constant === "number"){
  v531=v528.constant;
  v532=v533=v534=0;
  }
  else{
  v531=v528.constant.length>0?v528.constant[0]:0;
  v532=v528.constant.length>1?v528.constant[1]:0;
  v533=v528.constant.length>2?v528.constant[2]:0;
  v534=v528.constant.length>3?v528.constant[3]:0;
  }
  }
  else{
  if(v16(v528.buffer)){
  v535=v8.createStream(34962,v528.buffer);
  }
  else{
  v535=v8.getBuffer(v528.buffer);
  }
  v538="type" in v528?v49[v528.type]:v535.dtype;
  v537=!!v528.normalized;
  v536=v528.size|0;
  v539=v528.offset|0;
  v540=v528.stride|0;
  v541=v528.divisor|0;
  }
  }
  v543=g542.state;
  g542.state=v530;
  v544=g542.x;
  g542.x=v531;
  v545=g542.y;
  g542.y=v532;
  v546=g542.z;
  g542.z=v533;
  v547=g542.w;
  g542.w=v534;
  v548=g542.buffer;
  g542.buffer=v535;
  v549=g542.size;
  g542.size=v536;
  v550=g542.normalized;
  g542.normalized=v537;
  v551=g542.type;
  g542.type=v538;
  v552=g542.offset;
  g542.offset=v539;
  v553=g542.stride;
  g542.stride=v540;
  v554=g542.divisor;
  g542.divisor=v541;
  v555=g147.call(this,v2,a0,a2);
  if(!(v555&&(typeof v555==="object"||typeof v555==="function")&&(v16(v555)||v8.getBuffer(v555)||v8.getBuffer(v555.buffer)||v16(v555.buffer)||("constant" in v555&&(typeof v555.constant==="number"||v17(v555.constant))))))g18.commandRaise(g149,g19);
  v556=false;
  v557=1;
  v558=0;
  v559=0;
  v560=0;
  v561=0;
  v562=null;
  v563=0;
  v564=false;
  v565=5126;
  v566=0;
  v567=0;
  v568=0;
  if(v16(v555)){
  v556=true;
  v562=v8.createStream(34962,v555);
  v565=v562.dtype;
  }
  else{
  v562=v8.getBuffer(v555);
  if(v562){
  v565=v562.dtype;
  }
  else if("constant" in v555){
  v557=2;
  if(typeof v555.constant === "number"){
  v558=v555.constant;
  v559=v560=v561=0;
  }
  else{
  v558=v555.constant.length>0?v555.constant[0]:0;
  v559=v555.constant.length>1?v555.constant[1]:0;
  v560=v555.constant.length>2?v555.constant[2]:0;
  v561=v555.constant.length>3?v555.constant[3]:0;
  }
  }
  else{
  if(v16(v555.buffer)){
  v562=v8.createStream(34962,v555.buffer);
  }
  else{
  v562=v8.getBuffer(v555.buffer);
  }
  v565="type" in v555?v49[v555.type]:v562.dtype;
  v564=!!v555.normalized;
  v563=v555.size|0;
  v566=v555.offset|0;
  v567=v555.stride|0;
  v568=v555.divisor|0;
  }
  }
  v570=g569.state;
  g569.state=v557;
  v571=g569.x;
  g569.x=v558;
  v572=g569.y;
  g569.y=v559;
  v573=g569.z;
  g569.z=v560;
  v574=g569.w;
  g569.w=v561;
  v575=g569.buffer;
  g569.buffer=v562;
  v576=g569.size;
  g569.size=v563;
  v577=g569.normalized;
  g569.normalized=v564;
  v578=g569.type;
  g569.type=v565;
  v579=g569.offset;
  g569.offset=v566;
  v580=g569.stride;
  g569.stride=v567;
  v581=g569.divisor;
  g569.divisor=v568;
  v582=g107.call(this,v2,a0,a2);
  if(!(v582&&(typeof v582==="object"||typeof v582==="function")&&(v16(v582)||v8.getBuffer(v582)||v8.getBuffer(v582.buffer)||v16(v582.buffer)||("constant" in v582&&(typeof v582.constant==="number"||v17(v582.constant))))))g18.commandRaise(g109,g19);
  v583=false;
  v584=1;
  v585=0;
  v586=0;
  v587=0;
  v588=0;
  v589=null;
  v590=0;
  v591=false;
  v592=5126;
  v593=0;
  v594=0;
  v595=0;
  if(v16(v582)){
  v583=true;
  v589=v8.createStream(34962,v582);
  v592=v589.dtype;
  }
  else{
  v589=v8.getBuffer(v582);
  if(v589){
  v592=v589.dtype;
  }
  else if("constant" in v582){
  v584=2;
  if(typeof v582.constant === "number"){
  v585=v582.constant;
  v586=v587=v588=0;
  }
  else{
  v585=v582.constant.length>0?v582.constant[0]:0;
  v586=v582.constant.length>1?v582.constant[1]:0;
  v587=v582.constant.length>2?v582.constant[2]:0;
  v588=v582.constant.length>3?v582.constant[3]:0;
  }
  }
  else{
  if(v16(v582.buffer)){
  v589=v8.createStream(34962,v582.buffer);
  }
  else{
  v589=v8.getBuffer(v582.buffer);
  }
  v592="type" in v582?v49[v582.type]:v589.dtype;
  v591=!!v582.normalized;
  v590=v582.size|0;
  v593=v582.offset|0;
  v594=v582.stride|0;
  v595=v582.divisor|0;
  }
  }
  v597=g596.state;
  g596.state=v584;
  v598=g596.x;
  g596.x=v585;
  v599=g596.y;
  g596.y=v586;
  v600=g596.z;
  g596.z=v587;
  v601=g596.w;
  g596.w=v588;
  v602=g596.buffer;
  g596.buffer=v589;
  v603=g596.size;
  g596.size=v590;
  v604=g596.normalized;
  g596.normalized=v591;
  v605=g596.type;
  g596.type=v592;
  v606=g596.offset;
  g596.offset=v593;
  v607=g596.stride;
  g596.stride=v594;
  v608=g596.divisor;
  g596.divisor=v595;
  v609=g167.call(this,v2,a0,a2);
  if(!(v609&&(typeof v609==="object"||typeof v609==="function")&&(v16(v609)||v8.getBuffer(v609)||v8.getBuffer(v609.buffer)||v16(v609.buffer)||("constant" in v609&&(typeof v609.constant==="number"||v17(v609.constant))))))g18.commandRaise(g169,g19);
  v610=false;
  v611=1;
  v612=0;
  v613=0;
  v614=0;
  v615=0;
  v616=null;
  v617=0;
  v618=false;
  v619=5126;
  v620=0;
  v621=0;
  v622=0;
  if(v16(v609)){
  v610=true;
  v616=v8.createStream(34962,v609);
  v619=v616.dtype;
  }
  else{
  v616=v8.getBuffer(v609);
  if(v616){
  v619=v616.dtype;
  }
  else if("constant" in v609){
  v611=2;
  if(typeof v609.constant === "number"){
  v612=v609.constant;
  v613=v614=v615=0;
  }
  else{
  v612=v609.constant.length>0?v609.constant[0]:0;
  v613=v609.constant.length>1?v609.constant[1]:0;
  v614=v609.constant.length>2?v609.constant[2]:0;
  v615=v609.constant.length>3?v609.constant[3]:0;
  }
  }
  else{
  if(v16(v609.buffer)){
  v616=v8.createStream(34962,v609.buffer);
  }
  else{
  v616=v8.getBuffer(v609.buffer);
  }
  v619="type" in v609?v49[v609.type]:v616.dtype;
  v618=!!v609.normalized;
  v617=v609.size|0;
  v620=v609.offset|0;
  v621=v609.stride|0;
  v622=v609.divisor|0;
  }
  }
  v624=g623.state;
  g623.state=v611;
  v625=g623.x;
  g623.x=v612;
  v626=g623.y;
  g623.y=v613;
  v627=g623.z;
  g623.z=v614;
  v628=g623.w;
  g623.w=v615;
  v629=g623.buffer;
  g623.buffer=v616;
  v630=g623.size;
  g623.size=v617;
  v631=g623.normalized;
  g623.normalized=v618;
  v632=g623.type;
  g623.type=v619;
  v633=g623.offset;
  g623.offset=v620;
  v634=g623.stride;
  g623.stride=v621;
  v635=g623.divisor;
  g623.divisor=v622;
  v636=v9.vert;
  v9.vert=_gs[42];
  v637=v9.frag;
  v9.frag=_gs[43];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v336;
  v2.viewportHeight=v337;
  v42[0]=v338;
  v42[1]=v339;
  v42[2]=v340;
  v42[3]=v341;
  v20[0]=v342;
  v20[1]=v343;
  v20[2]=v344;
  v20[3]=v345;
  v4.blend_enable=v346;
  v24[0]=v347;
  v24[1]=v348;
  v24[2]=v349;
  v24[3]=v350;
  v4.depth_enable=v351;
  v40[0]=v357;
  v40[1]=v358;
  v40[2]=v359;
  v40[3]=v360;
  v4.scissor_enable=v361;
  v4.stencil_enable=v362;
  if(v363){
  g52.cpuTime+=performance.now()-v364;
  }
  if(v367){
  v7.destroyStream(v366);
  }
  v6.elements=v368;
  v6.offset=v370;
  v6.count=v372;
  v6.primitive=v373;
  v12[_gs[32]]=v374;
  v12[_gs[33]]=v376;
  v12[_gs[34]]=v378;
  v12[_gs[35]]=v380;
  v12[_gs[36]]=v382;
  v12[_gs[37]]=v384;
  v12[_gs[38]]=v386;
  v12[_gs[39]]=v388;
  v12[_gs[40]]=v390;
  v12[_gs[41]]=v392;
  if(v394){
  v8.destroyStream(v400);
  }
  g407.state=v408;
  g407.x=v409;
  g407.y=v410;
  g407.z=v411;
  g407.w=v412;
  g407.buffer=v413;
  g407.size=v414;
  g407.normalized=v415;
  g407.type=v416;
  g407.offset=v417;
  g407.stride=v418;
  g407.divisor=v419;
  if(v421){
  v8.destroyStream(v427);
  }
  g434.state=v435;
  g434.x=v436;
  g434.y=v437;
  g434.z=v438;
  g434.w=v439;
  g434.buffer=v440;
  g434.size=v441;
  g434.normalized=v442;
  g434.type=v443;
  g434.offset=v444;
  g434.stride=v445;
  g434.divisor=v446;
  if(v448){
  v8.destroyStream(v454);
  }
  g461.state=v462;
  g461.x=v463;
  g461.y=v464;
  g461.z=v465;
  g461.w=v466;
  g461.buffer=v467;
  g461.size=v468;
  g461.normalized=v469;
  g461.type=v470;
  g461.offset=v471;
  g461.stride=v472;
  g461.divisor=v473;
  if(v475){
  v8.destroyStream(v481);
  }
  g488.state=v489;
  g488.x=v490;
  g488.y=v491;
  g488.z=v492;
  g488.w=v493;
  g488.buffer=v494;
  g488.size=v495;
  g488.normalized=v496;
  g488.type=v497;
  g488.offset=v498;
  g488.stride=v499;
  g488.divisor=v500;
  if(v502){
  v8.destroyStream(v508);
  }
  g515.state=v516;
  g515.x=v517;
  g515.y=v518;
  g515.z=v519;
  g515.w=v520;
  g515.buffer=v521;
  g515.size=v522;
  g515.normalized=v523;
  g515.type=v524;
  g515.offset=v525;
  g515.stride=v526;
  g515.divisor=v527;
  if(v529){
  v8.destroyStream(v535);
  }
  g542.state=v543;
  g542.x=v544;
  g542.y=v545;
  g542.z=v546;
  g542.w=v547;
  g542.buffer=v548;
  g542.size=v549;
  g542.normalized=v550;
  g542.type=v551;
  g542.offset=v552;
  g542.stride=v553;
  g542.divisor=v554;
  if(v556){
  v8.destroyStream(v562);
  }
  g569.state=v570;
  g569.x=v571;
  g569.y=v572;
  g569.z=v573;
  g569.w=v574;
  g569.buffer=v575;
  g569.size=v576;
  g569.normalized=v577;
  g569.type=v578;
  g569.offset=v579;
  g569.stride=v580;
  g569.divisor=v581;
  if(v583){
  v8.destroyStream(v589);
  }
  g596.state=v597;
  g596.x=v598;
  g596.y=v599;
  g596.z=v600;
  g596.w=v601;
  g596.buffer=v602;
  g596.size=v603;
  g596.normalized=v604;
  g596.type=v605;
  g596.offset=v606;
  g596.stride=v607;
  g596.divisor=v608;
  if(v610){
  v8.destroyStream(v616);
  }
  g623.state=v624;
  g623.x=v625;
  g623.y=v626;
  g623.z=v627;
  g623.w=v628;
  g623.buffer=v629;
  g623.size=v630;
  g623.normalized=v631;
  g623.type=v632;
  g623.offset=v633;
  g623.stride=v634;
  g623.divisor=v635;
  v9.vert=v636;
  v9.frag=v637;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v638,v639,v674,v675,v676,v677,v678;
  v638=v14.angle_instanced_arrays;
  v639=v13.next;
  if(v639!==v13.cur){
  if(v639){
  v1.bindFramebuffer(36160,v639.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v639;
  }
  if(v5.dirty){
  var v640,v641,v642,v643,v644,v645,v646,v647,v648,v649,v650,v651,v652,v653,v654,v655,v656,v657,v658,v659,v660,v661,v662,v663,v664,v665,v666,v667,v668,v669,v670,v671,v672,v673;
  v640=v4.dither;
  if(v640!==v5.dither){
  if(v640){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v640;
  }
  v641=v22[0];
  v642=v22[1];
  if(v641!==v23[0]||v642!==v23[1]){
  v1.blendEquationSeparate(v641,v642);
  v23[0]=v641;
  v23[1]=v642;
  }
  v643=v4.depth_func;
  if(v643!==v5.depth_func){
  v1.depthFunc(v643);
  v5.depth_func=v643;
  }
  v644=v26[0];
  v645=v26[1];
  if(v644!==v27[0]||v645!==v27[1]){
  v1.depthRange(v644,v645);
  v27[0]=v644;
  v27[1]=v645;
  }
  v646=v4.depth_mask;
  if(v646!==v5.depth_mask){
  v1.depthMask(v646);
  v5.depth_mask=v646;
  }
  v647=v28[0];
  v648=v28[1];
  v649=v28[2];
  v650=v28[3];
  if(v647!==v29[0]||v648!==v29[1]||v649!==v29[2]||v650!==v29[3]){
  v1.colorMask(v647,v648,v649,v650);
  v29[0]=v647;
  v29[1]=v648;
  v29[2]=v649;
  v29[3]=v650;
  }
  v651=v4.cull_enable;
  if(v651!==v5.cull_enable){
  if(v651){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v651;
  }
  v652=v4.cull_face;
  if(v652!==v5.cull_face){
  v1.cullFace(v652);
  v5.cull_face=v652;
  }
  v653=v4.frontFace;
  if(v653!==v5.frontFace){
  v1.frontFace(v653);
  v5.frontFace=v653;
  }
  v654=v4.lineWidth;
  if(v654!==v5.lineWidth){
  v1.lineWidth(v654);
  v5.lineWidth=v654;
  }
  v655=v4.polygonOffset_enable;
  if(v655!==v5.polygonOffset_enable){
  if(v655){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v655;
  }
  v656=v30[0];
  v657=v30[1];
  if(v656!==v31[0]||v657!==v31[1]){
  v1.polygonOffset(v656,v657);
  v31[0]=v656;
  v31[1]=v657;
  }
  v658=v4.sample_alpha;
  if(v658!==v5.sample_alpha){
  if(v658){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v658;
  }
  v659=v4.sample_enable;
  if(v659!==v5.sample_enable){
  if(v659){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v659;
  }
  v660=v32[0];
  v661=v32[1];
  if(v660!==v33[0]||v661!==v33[1]){
  v1.sampleCoverage(v660,v661);
  v33[0]=v660;
  v33[1]=v661;
  }
  v662=v4.stencil_mask;
  if(v662!==v5.stencil_mask){
  v1.stencilMask(v662);
  v5.stencil_mask=v662;
  }
  v663=v34[0];
  v664=v34[1];
  v665=v34[2];
  if(v663!==v35[0]||v664!==v35[1]||v665!==v35[2]){
  v1.stencilFunc(v663,v664,v665);
  v35[0]=v663;
  v35[1]=v664;
  v35[2]=v665;
  }
  v666=v36[0];
  v667=v36[1];
  v668=v36[2];
  v669=v36[3];
  if(v666!==v37[0]||v667!==v37[1]||v668!==v37[2]||v669!==v37[3]){
  v1.stencilOpSeparate(v666,v667,v668,v669);
  v37[0]=v666;
  v37[1]=v667;
  v37[2]=v668;
  v37[3]=v669;
  }
  v670=v38[0];
  v671=v38[1];
  v672=v38[2];
  v673=v38[3];
  if(v670!==v39[0]||v671!==v39[1]||v672!==v39[2]||v673!==v39[3]){
  v1.stencilOpSeparate(v670,v671,v672,v673);
  v39[0]=v670;
  v39[1]=v671;
  v39[2]=v672;
  v39[3]=v673;
  }
  }
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[44]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[45];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[46]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[47];
  if(_gs[48]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[49];
  if(_gs[50]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[51];
  v674=v5.profile;
  if(v674){
  v675=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g105.program);
  v676=v14.angle_instanced_arrays;
  var v878;
  v11.setVAO(null);
  v1.uniform1i(g287.location,false);
  v1.uniform1i(g297.location,g298.bind());
  v878=v6.instances;
  for(v677=0;
  v677<a1;
  ++v677){
  v678=a0[v677];
  var v679,v680,v681,v682,v683,v684,v685,v686,v687,v688,v689,v690,v691,v692,v693,v694,v695,v696,v697,v698,v699,v700,v701,v702,v703,v704,v705,v706,v707,v708,v709,v710,v711,v712,v713,v714,v715,v716,v717,v718,v719,v720,v721,v722,v723,v724,v725,v726,v727,v728,v729,v730,v731,v732,v733,v734,v735,v736,v737,v738,v739,v740,v741,v742,v743,v744,v745,v746,v747,v748,v749,v750,v751,v752,v753,v754,v755,v756,v757,v758,v759,v760,v761,v762,v763,v764,v765,v766,v767,v768,v769,v770,v771,v772,v773,v774,v775,v776,v777,v778,v779,v780,v781,v782,v783,v784,v785,v786,v787,v788,v789,v790,v791,v792,v793,v794,v795,v796,v797,v798,v799,v800,v801,v802,v803,v804,v805,v806,v807,v808,v809,v810,v811,v812,v813,v814,v815,v816,v817,v818,v819,v820,v821,v822,v823,v824,v825,v826,v827,v828,v829,v830,v831,v832,v833,v834,v835,v836,v837,v838,v839,v840,v841,v842,v843,v844,v845,v846,v847,v848,v849,v850,v851,v852,v853,v854,v855,v856,v857,v858,v859,v860,v861,v862,v863,v864,v865,v866,v867,v868,v869,v870,v871,v872,v873,v874,v875,v876,v877;
  v679=v678["viewport"];
  if(!(v679&&typeof v679==="object"))g18.commandRaise(g90,g19);
  v680=v679.x|0;
  v681=v679.y|0;
  v682="width" in v679?v679.width|0:(v2.framebufferWidth-v680);
  v683="height" in v679?v679.height|0:(v2.framebufferHeight-v681);
  if(!(v682>=0&&v683>=0))g18.commandRaise(g90,g19);
  v684=v2.viewportWidth;
  v2.viewportWidth=v682;
  v685=v2.viewportHeight;
  v2.viewportHeight=v683;
  v1.viewport(v680,v681,v682,v683);
  v43[0]=v680;
  v43[1]=v681;
  v43[2]=v682;
  v43[3]=v683;
  v686=v678["viewport"];
  if(!(v686&&typeof v686==="object"))g18.commandRaise(g98,g19);
  v687=v686.x|0;
  v688=v686.y|0;
  v689="width" in v686?v686.width|0:(v2.framebufferWidth-v687);
  v690="height" in v686?v686.height|0:(v2.framebufferHeight-v688);
  if(!(v689>=0&&v690>=0))g18.commandRaise(g98,g19);
  v1.scissor(v687,v688,v689,v690);
  v41[0]=v687;
  v41[1]=v688;
  v41[2]=v689;
  v41[3]=v690;
  v691=g107.call(this,v2,v678,v677);
  if(!(v691&&(typeof v691==="object"||typeof v691==="function")&&(v16(v691)||v8.getBuffer(v691)||v8.getBuffer(v691.buffer)||v16(v691.buffer)||("constant" in v691&&(typeof v691.constant==="number"||v17(v691.constant))))))g18.commandRaise(g109,g19);
  v692=false;
  v693=1;
  v694=0;
  v695=0;
  v696=0;
  v697=0;
  v698=null;
  v699=0;
  v700=false;
  v701=5126;
  v702=0;
  v703=0;
  v704=0;
  if(v16(v691)){
  v692=true;
  v698=v8.createStream(34962,v691);
  v701=v698.dtype;
  }
  else{
  v698=v8.getBuffer(v691);
  if(v698){
  v701=v698.dtype;
  }
  else if("constant" in v691){
  v693=2;
  if(typeof v691.constant === "number"){
  v694=v691.constant;
  v695=v696=v697=0;
  }
  else{
  v694=v691.constant.length>0?v691.constant[0]:0;
  v695=v691.constant.length>1?v691.constant[1]:0;
  v696=v691.constant.length>2?v691.constant[2]:0;
  v697=v691.constant.length>3?v691.constant[3]:0;
  }
  }
  else{
  if(v16(v691.buffer)){
  v698=v8.createStream(34962,v691.buffer);
  }
  else{
  v698=v8.getBuffer(v691.buffer);
  }
  v701="type" in v691?v49[v691.type]:v698.dtype;
  v700=!!v691.normalized;
  v699=v691.size|0;
  v702=v691.offset|0;
  v703=v691.stride|0;
  v704=v691.divisor|0;
  }
  }
  v705=g123.location;
  v706=v10[v705];
  if(v693===1){
  if(!v706.buffer){
  v1.enableVertexAttribArray(v705);
  }
  v707=v699||4;
  if(v706.type!==v701||v706.size!==v707||v706.buffer!==v698||v706.normalized!==v700||v706.offset!==v702||v706.stride!==v703){
  v1.bindBuffer(34962,v698.buffer);
  v1.vertexAttribPointer(v705,v707,v701,v700,v703,v702);
  v706.type=v701;
  v706.size=v707;
  v706.buffer=v698;
  v706.normalized=v700;
  v706.offset=v702;
  v706.stride=v703;
  }
  if(v706.divisor!==v704){
  v676.vertexAttribDivisorANGLE(v705,v704);
  v706.divisor=v704;
  }
  }
  else{
  if(v706.buffer){
  v1.disableVertexAttribArray(v705);
  v706.buffer=null;
  }
  if(v706.x!==v694||v706.y!==v695||v706.z!==v696||v706.w!==v697){
  v1.vertexAttrib4f(v705,v694,v695,v696,v697);
  v706.x=v694;
  v706.y=v695;
  v706.z=v696;
  v706.w=v697;
  }
  }
  v708=g127.call(this,v2,v678,v677);
  if(!(v708&&(typeof v708==="object"||typeof v708==="function")&&(v16(v708)||v8.getBuffer(v708)||v8.getBuffer(v708.buffer)||v16(v708.buffer)||("constant" in v708&&(typeof v708.constant==="number"||v17(v708.constant))))))g18.commandRaise(g129,g19);
  v709=false;
  v710=1;
  v711=0;
  v712=0;
  v713=0;
  v714=0;
  v715=null;
  v716=0;
  v717=false;
  v718=5126;
  v719=0;
  v720=0;
  v721=0;
  if(v16(v708)){
  v709=true;
  v715=v8.createStream(34962,v708);
  v718=v715.dtype;
  }
  else{
  v715=v8.getBuffer(v708);
  if(v715){
  v718=v715.dtype;
  }
  else if("constant" in v708){
  v710=2;
  if(typeof v708.constant === "number"){
  v711=v708.constant;
  v712=v713=v714=0;
  }
  else{
  v711=v708.constant.length>0?v708.constant[0]:0;
  v712=v708.constant.length>1?v708.constant[1]:0;
  v713=v708.constant.length>2?v708.constant[2]:0;
  v714=v708.constant.length>3?v708.constant[3]:0;
  }
  }
  else{
  if(v16(v708.buffer)){
  v715=v8.createStream(34962,v708.buffer);
  }
  else{
  v715=v8.getBuffer(v708.buffer);
  }
  v718="type" in v708?v49[v708.type]:v715.dtype;
  v717=!!v708.normalized;
  v716=v708.size|0;
  v719=v708.offset|0;
  v720=v708.stride|0;
  v721=v708.divisor|0;
  }
  }
  v722=g143.location;
  v723=v10[v722];
  if(v710===1){
  if(!v723.buffer){
  v1.enableVertexAttribArray(v722);
  }
  v724=v716||1;
  if(v723.type!==v718||v723.size!==v724||v723.buffer!==v715||v723.normalized!==v717||v723.offset!==v719||v723.stride!==v720){
  v1.bindBuffer(34962,v715.buffer);
  v1.vertexAttribPointer(v722,v724,v718,v717,v720,v719);
  v723.type=v718;
  v723.size=v724;
  v723.buffer=v715;
  v723.normalized=v717;
  v723.offset=v719;
  v723.stride=v720;
  }
  if(v723.divisor!==v721){
  v676.vertexAttribDivisorANGLE(v722,v721);
  v723.divisor=v721;
  }
  }
  else{
  if(v723.buffer){
  v1.disableVertexAttribArray(v722);
  v723.buffer=null;
  }
  if(v723.x!==v711||v723.y!==v712||v723.z!==v713||v723.w!==v714){
  v1.vertexAttrib4f(v722,v711,v712,v713,v714);
  v723.x=v711;
  v723.y=v712;
  v723.z=v713;
  v723.w=v714;
  }
  }
  v725=g147.call(this,v2,v678,v677);
  if(!(v725&&(typeof v725==="object"||typeof v725==="function")&&(v16(v725)||v8.getBuffer(v725)||v8.getBuffer(v725.buffer)||v16(v725.buffer)||("constant" in v725&&(typeof v725.constant==="number"||v17(v725.constant))))))g18.commandRaise(g149,g19);
  v726=false;
  v727=1;
  v728=0;
  v729=0;
  v730=0;
  v731=0;
  v732=null;
  v733=0;
  v734=false;
  v735=5126;
  v736=0;
  v737=0;
  v738=0;
  if(v16(v725)){
  v726=true;
  v732=v8.createStream(34962,v725);
  v735=v732.dtype;
  }
  else{
  v732=v8.getBuffer(v725);
  if(v732){
  v735=v732.dtype;
  }
  else if("constant" in v725){
  v727=2;
  if(typeof v725.constant === "number"){
  v728=v725.constant;
  v729=v730=v731=0;
  }
  else{
  v728=v725.constant.length>0?v725.constant[0]:0;
  v729=v725.constant.length>1?v725.constant[1]:0;
  v730=v725.constant.length>2?v725.constant[2]:0;
  v731=v725.constant.length>3?v725.constant[3]:0;
  }
  }
  else{
  if(v16(v725.buffer)){
  v732=v8.createStream(34962,v725.buffer);
  }
  else{
  v732=v8.getBuffer(v725.buffer);
  }
  v735="type" in v725?v49[v725.type]:v732.dtype;
  v734=!!v725.normalized;
  v733=v725.size|0;
  v736=v725.offset|0;
  v737=v725.stride|0;
  v738=v725.divisor|0;
  }
  }
  v739=g163.location;
  v740=v10[v739];
  if(v727===1){
  if(!v740.buffer){
  v1.enableVertexAttribArray(v739);
  }
  v741=v733||4;
  if(v740.type!==v735||v740.size!==v741||v740.buffer!==v732||v740.normalized!==v734||v740.offset!==v736||v740.stride!==v737){
  v1.bindBuffer(34962,v732.buffer);
  v1.vertexAttribPointer(v739,v741,v735,v734,v737,v736);
  v740.type=v735;
  v740.size=v741;
  v740.buffer=v732;
  v740.normalized=v734;
  v740.offset=v736;
  v740.stride=v737;
  }
  if(v740.divisor!==v738){
  v676.vertexAttribDivisorANGLE(v739,v738);
  v740.divisor=v738;
  }
  }
  else{
  if(v740.buffer){
  v1.disableVertexAttribArray(v739);
  v740.buffer=null;
  }
  if(v740.x!==v728||v740.y!==v729||v740.z!==v730||v740.w!==v731){
  v1.vertexAttrib4f(v739,v728,v729,v730,v731);
  v740.x=v728;
  v740.y=v729;
  v740.z=v730;
  v740.w=v731;
  }
  }
  v742=g167.call(this,v2,v678,v677);
  if(!(v742&&(typeof v742==="object"||typeof v742==="function")&&(v16(v742)||v8.getBuffer(v742)||v8.getBuffer(v742.buffer)||v16(v742.buffer)||("constant" in v742&&(typeof v742.constant==="number"||v17(v742.constant))))))g18.commandRaise(g169,g19);
  v743=false;
  v744=1;
  v745=0;
  v746=0;
  v747=0;
  v748=0;
  v749=null;
  v750=0;
  v751=false;
  v752=5126;
  v753=0;
  v754=0;
  v755=0;
  if(v16(v742)){
  v743=true;
  v749=v8.createStream(34962,v742);
  v752=v749.dtype;
  }
  else{
  v749=v8.getBuffer(v742);
  if(v749){
  v752=v749.dtype;
  }
  else if("constant" in v742){
  v744=2;
  if(typeof v742.constant === "number"){
  v745=v742.constant;
  v746=v747=v748=0;
  }
  else{
  v745=v742.constant.length>0?v742.constant[0]:0;
  v746=v742.constant.length>1?v742.constant[1]:0;
  v747=v742.constant.length>2?v742.constant[2]:0;
  v748=v742.constant.length>3?v742.constant[3]:0;
  }
  }
  else{
  if(v16(v742.buffer)){
  v749=v8.createStream(34962,v742.buffer);
  }
  else{
  v749=v8.getBuffer(v742.buffer);
  }
  v752="type" in v742?v49[v742.type]:v749.dtype;
  v751=!!v742.normalized;
  v750=v742.size|0;
  v753=v742.offset|0;
  v754=v742.stride|0;
  v755=v742.divisor|0;
  }
  }
  v756=g183.location;
  v757=v10[v756];
  if(v744===1){
  if(!v757.buffer){
  v1.enableVertexAttribArray(v756);
  }
  v758=v750||1;
  if(v757.type!==v752||v757.size!==v758||v757.buffer!==v749||v757.normalized!==v751||v757.offset!==v753||v757.stride!==v754){
  v1.bindBuffer(34962,v749.buffer);
  v1.vertexAttribPointer(v756,v758,v752,v751,v754,v753);
  v757.type=v752;
  v757.size=v758;
  v757.buffer=v749;
  v757.normalized=v751;
  v757.offset=v753;
  v757.stride=v754;
  }
  if(v757.divisor!==v755){
  v676.vertexAttribDivisorANGLE(v756,v755);
  v757.divisor=v755;
  }
  }
  else{
  if(v757.buffer){
  v1.disableVertexAttribArray(v756);
  v757.buffer=null;
  }
  if(v757.x!==v745||v757.y!==v746||v757.z!==v747||v757.w!==v748){
  v1.vertexAttrib4f(v756,v745,v746,v747,v748);
  v757.x=v745;
  v757.y=v746;
  v757.z=v747;
  v757.w=v748;
  }
  }
  v759=g187.call(this,v2,v678,v677);
  if(!(v759&&(typeof v759==="object"||typeof v759==="function")&&(v16(v759)||v8.getBuffer(v759)||v8.getBuffer(v759.buffer)||v16(v759.buffer)||("constant" in v759&&(typeof v759.constant==="number"||v17(v759.constant))))))g18.commandRaise(g189,g19);
  v760=false;
  v761=1;
  v762=0;
  v763=0;
  v764=0;
  v765=0;
  v766=null;
  v767=0;
  v768=false;
  v769=5126;
  v770=0;
  v771=0;
  v772=0;
  if(v16(v759)){
  v760=true;
  v766=v8.createStream(34962,v759);
  v769=v766.dtype;
  }
  else{
  v766=v8.getBuffer(v759);
  if(v766){
  v769=v766.dtype;
  }
  else if("constant" in v759){
  v761=2;
  if(typeof v759.constant === "number"){
  v762=v759.constant;
  v763=v764=v765=0;
  }
  else{
  v762=v759.constant.length>0?v759.constant[0]:0;
  v763=v759.constant.length>1?v759.constant[1]:0;
  v764=v759.constant.length>2?v759.constant[2]:0;
  v765=v759.constant.length>3?v759.constant[3]:0;
  }
  }
  else{
  if(v16(v759.buffer)){
  v766=v8.createStream(34962,v759.buffer);
  }
  else{
  v766=v8.getBuffer(v759.buffer);
  }
  v769="type" in v759?v49[v759.type]:v766.dtype;
  v768=!!v759.normalized;
  v767=v759.size|0;
  v770=v759.offset|0;
  v771=v759.stride|0;
  v772=v759.divisor|0;
  }
  }
  v773=g203.location;
  v774=v10[v773];
  if(v761===1){
  if(!v774.buffer){
  v1.enableVertexAttribArray(v773);
  }
  v775=v767||1;
  if(v774.type!==v769||v774.size!==v775||v774.buffer!==v766||v774.normalized!==v768||v774.offset!==v770||v774.stride!==v771){
  v1.bindBuffer(34962,v766.buffer);
  v1.vertexAttribPointer(v773,v775,v769,v768,v771,v770);
  v774.type=v769;
  v774.size=v775;
  v774.buffer=v766;
  v774.normalized=v768;
  v774.offset=v770;
  v774.stride=v771;
  }
  if(v774.divisor!==v772){
  v676.vertexAttribDivisorANGLE(v773,v772);
  v774.divisor=v772;
  }
  }
  else{
  if(v774.buffer){
  v1.disableVertexAttribArray(v773);
  v774.buffer=null;
  }
  if(v774.x!==v762||v774.y!==v763||v774.z!==v764||v774.w!==v765){
  v1.vertexAttrib4f(v773,v762,v763,v764,v765);
  v774.x=v762;
  v774.y=v763;
  v774.z=v764;
  v774.w=v765;
  }
  }
  v776=g207.call(this,v2,v678,v677);
  if(!(v776&&(typeof v776==="object"||typeof v776==="function")&&(v16(v776)||v8.getBuffer(v776)||v8.getBuffer(v776.buffer)||v16(v776.buffer)||("constant" in v776&&(typeof v776.constant==="number"||v17(v776.constant))))))g18.commandRaise(g209,g19);
  v777=false;
  v778=1;
  v779=0;
  v780=0;
  v781=0;
  v782=0;
  v783=null;
  v784=0;
  v785=false;
  v786=5126;
  v787=0;
  v788=0;
  v789=0;
  if(v16(v776)){
  v777=true;
  v783=v8.createStream(34962,v776);
  v786=v783.dtype;
  }
  else{
  v783=v8.getBuffer(v776);
  if(v783){
  v786=v783.dtype;
  }
  else if("constant" in v776){
  v778=2;
  if(typeof v776.constant === "number"){
  v779=v776.constant;
  v780=v781=v782=0;
  }
  else{
  v779=v776.constant.length>0?v776.constant[0]:0;
  v780=v776.constant.length>1?v776.constant[1]:0;
  v781=v776.constant.length>2?v776.constant[2]:0;
  v782=v776.constant.length>3?v776.constant[3]:0;
  }
  }
  else{
  if(v16(v776.buffer)){
  v783=v8.createStream(34962,v776.buffer);
  }
  else{
  v783=v8.getBuffer(v776.buffer);
  }
  v786="type" in v776?v49[v776.type]:v783.dtype;
  v785=!!v776.normalized;
  v784=v776.size|0;
  v787=v776.offset|0;
  v788=v776.stride|0;
  v789=v776.divisor|0;
  }
  }
  v790=g223.location;
  v791=v10[v790];
  if(v778===1){
  if(!v791.buffer){
  v1.enableVertexAttribArray(v790);
  }
  v792=v784||1;
  if(v791.type!==v786||v791.size!==v792||v791.buffer!==v783||v791.normalized!==v785||v791.offset!==v787||v791.stride!==v788){
  v1.bindBuffer(34962,v783.buffer);
  v1.vertexAttribPointer(v790,v792,v786,v785,v788,v787);
  v791.type=v786;
  v791.size=v792;
  v791.buffer=v783;
  v791.normalized=v785;
  v791.offset=v787;
  v791.stride=v788;
  }
  if(v791.divisor!==v789){
  v676.vertexAttribDivisorANGLE(v790,v789);
  v791.divisor=v789;
  }
  }
  else{
  if(v791.buffer){
  v1.disableVertexAttribArray(v790);
  v791.buffer=null;
  }
  if(v791.x!==v779||v791.y!==v780||v791.z!==v781||v791.w!==v782){
  v1.vertexAttrib4f(v790,v779,v780,v781,v782);
  v791.x=v779;
  v791.y=v780;
  v791.z=v781;
  v791.w=v782;
  }
  }
  v793=g227.call(this,v2,v678,v677);
  if(!(v793&&(typeof v793==="object"||typeof v793==="function")&&(v16(v793)||v8.getBuffer(v793)||v8.getBuffer(v793.buffer)||v16(v793.buffer)||("constant" in v793&&(typeof v793.constant==="number"||v17(v793.constant))))))g18.commandRaise(g229,g19);
  v794=false;
  v795=1;
  v796=0;
  v797=0;
  v798=0;
  v799=0;
  v800=null;
  v801=0;
  v802=false;
  v803=5126;
  v804=0;
  v805=0;
  v806=0;
  if(v16(v793)){
  v794=true;
  v800=v8.createStream(34962,v793);
  v803=v800.dtype;
  }
  else{
  v800=v8.getBuffer(v793);
  if(v800){
  v803=v800.dtype;
  }
  else if("constant" in v793){
  v795=2;
  if(typeof v793.constant === "number"){
  v796=v793.constant;
  v797=v798=v799=0;
  }
  else{
  v796=v793.constant.length>0?v793.constant[0]:0;
  v797=v793.constant.length>1?v793.constant[1]:0;
  v798=v793.constant.length>2?v793.constant[2]:0;
  v799=v793.constant.length>3?v793.constant[3]:0;
  }
  }
  else{
  if(v16(v793.buffer)){
  v800=v8.createStream(34962,v793.buffer);
  }
  else{
  v800=v8.getBuffer(v793.buffer);
  }
  v803="type" in v793?v49[v793.type]:v800.dtype;
  v802=!!v793.normalized;
  v801=v793.size|0;
  v804=v793.offset|0;
  v805=v793.stride|0;
  v806=v793.divisor|0;
  }
  }
  v807=g243.location;
  v808=v10[v807];
  if(v795===1){
  if(!v808.buffer){
  v1.enableVertexAttribArray(v807);
  }
  v809=v801||1;
  if(v808.type!==v803||v808.size!==v809||v808.buffer!==v800||v808.normalized!==v802||v808.offset!==v804||v808.stride!==v805){
  v1.bindBuffer(34962,v800.buffer);
  v1.vertexAttribPointer(v807,v809,v803,v802,v805,v804);
  v808.type=v803;
  v808.size=v809;
  v808.buffer=v800;
  v808.normalized=v802;
  v808.offset=v804;
  v808.stride=v805;
  }
  if(v808.divisor!==v806){
  v676.vertexAttribDivisorANGLE(v807,v806);
  v808.divisor=v806;
  }
  }
  else{
  if(v808.buffer){
  v1.disableVertexAttribArray(v807);
  v808.buffer=null;
  }
  if(v808.x!==v796||v808.y!==v797||v808.z!==v798||v808.w!==v799){
  v1.vertexAttrib4f(v807,v796,v797,v798,v799);
  v808.x=v796;
  v808.y=v797;
  v808.z=v798;
  v808.w=v799;
  }
  }
  v810=g247.call(this,v2,v678,v677);
  if(!(v810&&(typeof v810==="object"||typeof v810==="function")&&(v16(v810)||v8.getBuffer(v810)||v8.getBuffer(v810.buffer)||v16(v810.buffer)||("constant" in v810&&(typeof v810.constant==="number"||v17(v810.constant))))))g18.commandRaise(g249,g19);
  v811=false;
  v812=1;
  v813=0;
  v814=0;
  v815=0;
  v816=0;
  v817=null;
  v818=0;
  v819=false;
  v820=5126;
  v821=0;
  v822=0;
  v823=0;
  if(v16(v810)){
  v811=true;
  v817=v8.createStream(34962,v810);
  v820=v817.dtype;
  }
  else{
  v817=v8.getBuffer(v810);
  if(v817){
  v820=v817.dtype;
  }
  else if("constant" in v810){
  v812=2;
  if(typeof v810.constant === "number"){
  v813=v810.constant;
  v814=v815=v816=0;
  }
  else{
  v813=v810.constant.length>0?v810.constant[0]:0;
  v814=v810.constant.length>1?v810.constant[1]:0;
  v815=v810.constant.length>2?v810.constant[2]:0;
  v816=v810.constant.length>3?v810.constant[3]:0;
  }
  }
  else{
  if(v16(v810.buffer)){
  v817=v8.createStream(34962,v810.buffer);
  }
  else{
  v817=v8.getBuffer(v810.buffer);
  }
  v820="type" in v810?v49[v810.type]:v817.dtype;
  v819=!!v810.normalized;
  v818=v810.size|0;
  v821=v810.offset|0;
  v822=v810.stride|0;
  v823=v810.divisor|0;
  }
  }
  v824=g263.location;
  v825=v10[v824];
  if(v812===1){
  if(!v825.buffer){
  v1.enableVertexAttribArray(v824);
  }
  v826=v818||1;
  if(v825.type!==v820||v825.size!==v826||v825.buffer!==v817||v825.normalized!==v819||v825.offset!==v821||v825.stride!==v822){
  v1.bindBuffer(34962,v817.buffer);
  v1.vertexAttribPointer(v824,v826,v820,v819,v822,v821);
  v825.type=v820;
  v825.size=v826;
  v825.buffer=v817;
  v825.normalized=v819;
  v825.offset=v821;
  v825.stride=v822;
  }
  if(v825.divisor!==v823){
  v676.vertexAttribDivisorANGLE(v824,v823);
  v825.divisor=v823;
  }
  }
  else{
  if(v825.buffer){
  v1.disableVertexAttribArray(v824);
  v825.buffer=null;
  }
  if(v825.x!==v813||v825.y!==v814||v825.z!==v815||v825.w!==v816){
  v1.vertexAttrib4f(v824,v813,v814,v815,v816);
  v825.x=v813;
  v825.y=v814;
  v825.z=v815;
  v825.w=v816;
  }
  }
  v827=g267.call(this,v2,v678,v677);
  if(!(v827&&(typeof v827==="object"||typeof v827==="function")&&(v16(v827)||v8.getBuffer(v827)||v8.getBuffer(v827.buffer)||v16(v827.buffer)||("constant" in v827&&(typeof v827.constant==="number"||v17(v827.constant))))))g18.commandRaise(g269,g19);
  v828=false;
  v829=1;
  v830=0;
  v831=0;
  v832=0;
  v833=0;
  v834=null;
  v835=0;
  v836=false;
  v837=5126;
  v838=0;
  v839=0;
  v840=0;
  if(v16(v827)){
  v828=true;
  v834=v8.createStream(34962,v827);
  v837=v834.dtype;
  }
  else{
  v834=v8.getBuffer(v827);
  if(v834){
  v837=v834.dtype;
  }
  else if("constant" in v827){
  v829=2;
  if(typeof v827.constant === "number"){
  v830=v827.constant;
  v831=v832=v833=0;
  }
  else{
  v830=v827.constant.length>0?v827.constant[0]:0;
  v831=v827.constant.length>1?v827.constant[1]:0;
  v832=v827.constant.length>2?v827.constant[2]:0;
  v833=v827.constant.length>3?v827.constant[3]:0;
  }
  }
  else{
  if(v16(v827.buffer)){
  v834=v8.createStream(34962,v827.buffer);
  }
  else{
  v834=v8.getBuffer(v827.buffer);
  }
  v837="type" in v827?v49[v827.type]:v834.dtype;
  v836=!!v827.normalized;
  v835=v827.size|0;
  v838=v827.offset|0;
  v839=v827.stride|0;
  v840=v827.divisor|0;
  }
  }
  v841=g283.location;
  v842=v10[v841];
  if(v829===1){
  if(!v842.buffer){
  v1.enableVertexAttribArray(v841);
  }
  v843=v835||1;
  if(v842.type!==v837||v842.size!==v843||v842.buffer!==v834||v842.normalized!==v836||v842.offset!==v838||v842.stride!==v839){
  v1.bindBuffer(34962,v834.buffer);
  v1.vertexAttribPointer(v841,v843,v837,v836,v839,v838);
  v842.type=v837;
  v842.size=v843;
  v842.buffer=v834;
  v842.normalized=v836;
  v842.offset=v838;
  v842.stride=v839;
  }
  if(v842.divisor!==v840){
  v676.vertexAttribDivisorANGLE(v841,v840);
  v842.divisor=v840;
  }
  }
  else{
  if(v842.buffer){
  v1.disableVertexAttribArray(v841);
  v842.buffer=null;
  }
  if(v842.x!==v830||v842.y!==v831||v842.z!==v832||v842.w!==v833){
  v1.vertexAttrib4f(v841,v830,v831,v832,v833);
  v842.x=v830;
  v842.y=v831;
  v842.z=v832;
  v842.w=v833;
  }
  }
  v844=v678["opacity"];
  if(!(typeof v844==="number"))g18.commandRaise(g290,g19);
  if(!v677||v845!==v844){
  v845=v844;
  v1.uniform1f(g288.location,v844);
  }
  v846=g292.call(this,v2,v678,v677);
  if(!(v17(v846)&&v846.length===2))g18.commandRaise(g294,g19);
  v847=v846[0];
  v849=v846[1];
  if(!v677||v848!==v847||v850!==v849){
  v848=v847;
  v850=v849;
  v1.uniform2f(g291.location,v847,v849);
  }
  v851=v2["pixelRatio"];
  if(!(typeof v851==="number"))g18.commandRaise(g301,g19);
  if(!v677||v852!==v851){
  v852=v851;
  v1.uniform1f(g299.location,v851);
  }
  v853=v678["scale"];
  if(!(v17(v853)&&v853.length===2))g18.commandRaise(g304,g19);
  v854=v853[0];
  v856=v853[1];
  if(!v677||v855!==v854||v857!==v856){
  v855=v854;
  v857=v856;
  v1.uniform2f(g302.location,v854,v856);
  }
  v858=v678["scaleFract"];
  if(!(v17(v858)&&v858.length===2))g18.commandRaise(g309,g19);
  v859=v858[0];
  v861=v858[1];
  if(!v677||v860!==v859||v862!==v861){
  v860=v859;
  v862=v861;
  v1.uniform2f(g307.location,v859,v861);
  }
  v863=v678["translate"];
  if(!(v17(v863)&&v863.length===2))g18.commandRaise(g314,g19);
  v864=v863[0];
  v866=v863[1];
  if(!v677||v865!==v864||v867!==v866){
  v865=v864;
  v867=v866;
  v1.uniform2f(g312.location,v864,v866);
  }
  v868=v678["translateFract"];
  if(!(v17(v868)&&v868.length===2))g18.commandRaise(g319,g19);
  v869=v868[0];
  v871=v868[1];
  if(!v677||v870!==v869||v872!==v871){
  v870=v869;
  v872=v871;
  v1.uniform2f(g317.location,v869,v871);
  }
  v873=v678["elements"];
  v874=null;
  v875=v16(v873);
  if(v875){
  v874=v7.createStream(v873);
  }
  else{
  v874=v7.getElements(v873);
  if(!(!v873||v874))g18.commandRaise(g325,g19);
  }
  if(v874)v1.bindBuffer(34963,v874.buffer.buffer);
  v876=v678["offset"];
  if(!(v876>=0))g18.commandRaise(g327,g19);
  v877=v678["count"];
  if(!(typeof v877==="number"&&v877>=0&&v877===(v877|0)))g18.commandRaise(g329,g19);
  if(v877){
  if(v878>0){
  if(v874){
  v676.drawElementsInstancedANGLE(0,v877,v874.type,v876<<((v874.type-5121)>>1),v878);
  }
  else{
  v676.drawArraysInstancedANGLE(0,v876,v877,v878);
  }
  }
  else if(v878<0){
  if(v874){
  v1.drawElements(0,v877,v874.type,v876<<((v874.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v876,v877);
  }
  }
  v2.viewportWidth=v684;
  v2.viewportHeight=v685;
  if(v692){
  v8.destroyStream(v698);
  }
  if(v709){
  v8.destroyStream(v715);
  }
  if(v726){
  v8.destroyStream(v732);
  }
  if(v743){
  v8.destroyStream(v749);
  }
  if(v760){
  v8.destroyStream(v766);
  }
  if(v777){
  v8.destroyStream(v783);
  }
  if(v794){
  v8.destroyStream(v800);
  }
  if(v811){
  v8.destroyStream(v817);
  }
  if(v828){
  v8.destroyStream(v834);
  }
  if(v875){
  v7.destroyStream(v874);
  }
  }
  }
  g298.unbind();
  v5.dirty=true;
  v11.setVAO(null);
  if(v674){
  g52.cpuTime+=performance.now()-v675;
  }
  }
  ,}
  
  },
  "46895.244": function (_gs, g0, g18, g19, g52, g54, g56, g58, g60, g97, g105, g112, g114, g115, g118, g120, g134, g138, g141, g143, g157, g161, g164, g166, g180, g184, g186, g200, g204, g206, g207, g209, g210, g212, g213, g215, g218, g220, g223, g225, g228, g230, g233, g234, g236, g301, g314, g327, g354, g381, g408, g435) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v55,v57,v59;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v53.buffer=g54;
  v53.divisor=1;
  v55={
  }
  ;
  v55.buffer=g56;
  v55.divisor=1;
  v57={
  }
  ;
  v57.buffer=g58;
  v57.divisor=1;
  v59={
  }
  ;
  v59.buffer=g60;
  v59.divisor=1;
  return {
  "draw":function(a0){
  var v61,v62,v96,v98,v99,v100,v101,v102,v103,v104,v106,v107,v108,v109,v110,v111,v113,v116,v117,v119,v121,v122,v123,v124,v125,v126,v127,v128,v129,v130,v131,v132,v133,v135,v136,v137,v139,v140,v142,v144,v145,v146,v147,v148,v149,v150,v151,v152,v153,v154,v155,v156,v158,v159,v160,v162,v163,v165,v167,v168,v169,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v181,v182,v183,v185,v187,v188,v189,v190,v191,v192,v193,v194,v195,v196,v197,v198,v199,v201,v202,v203,v205,v208,v211,v214,v216,v217,v219,v221,v222,v224,v226,v227,v229,v231,v232,v235,v237,v238,v239,v240,v241,v242,v243;
  v61=v14.angle_instanced_arrays;
  v62=v13.next;
  if(v62!==v13.cur){
  if(v62){
  v1.bindFramebuffer(36160,v62.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v62;
  }
  if(v5.dirty){
  var v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95;
  v63=v4.dither;
  if(v63!==v5.dither){
  if(v63){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v63;
  }
  v64=v4.depth_func;
  if(v64!==v5.depth_func){
  v1.depthFunc(v64);
  v5.depth_func=v64;
  }
  v65=v26[0];
  v66=v26[1];
  if(v65!==v27[0]||v66!==v27[1]){
  v1.depthRange(v65,v66);
  v27[0]=v65;
  v27[1]=v66;
  }
  v67=v4.depth_mask;
  if(v67!==v5.depth_mask){
  v1.depthMask(v67);
  v5.depth_mask=v67;
  }
  v68=v28[0];
  v69=v28[1];
  v70=v28[2];
  v71=v28[3];
  if(v68!==v29[0]||v69!==v29[1]||v70!==v29[2]||v71!==v29[3]){
  v1.colorMask(v68,v69,v70,v71);
  v29[0]=v68;
  v29[1]=v69;
  v29[2]=v70;
  v29[3]=v71;
  }
  v72=v4.cull_enable;
  if(v72!==v5.cull_enable){
  if(v72){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v72;
  }
  v73=v4.cull_face;
  if(v73!==v5.cull_face){
  v1.cullFace(v73);
  v5.cull_face=v73;
  }
  v74=v4.frontFace;
  if(v74!==v5.frontFace){
  v1.frontFace(v74);
  v5.frontFace=v74;
  }
  v75=v4.lineWidth;
  if(v75!==v5.lineWidth){
  v1.lineWidth(v75);
  v5.lineWidth=v75;
  }
  v76=v4.polygonOffset_enable;
  if(v76!==v5.polygonOffset_enable){
  if(v76){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v76;
  }
  v77=v30[0];
  v78=v30[1];
  if(v77!==v31[0]||v78!==v31[1]){
  v1.polygonOffset(v77,v78);
  v31[0]=v77;
  v31[1]=v78;
  }
  v79=v4.sample_alpha;
  if(v79!==v5.sample_alpha){
  if(v79){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v79;
  }
  v80=v4.sample_enable;
  if(v80!==v5.sample_enable){
  if(v80){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v80;
  }
  v81=v32[0];
  v82=v32[1];
  if(v81!==v33[0]||v82!==v33[1]){
  v1.sampleCoverage(v81,v82);
  v33[0]=v81;
  v33[1]=v82;
  }
  v83=v4.stencil_enable;
  if(v83!==v5.stencil_enable){
  if(v83){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v83;
  }
  v84=v4.stencil_mask;
  if(v84!==v5.stencil_mask){
  v1.stencilMask(v84);
  v5.stencil_mask=v84;
  }
  v85=v34[0];
  v86=v34[1];
  v87=v34[2];
  if(v85!==v35[0]||v86!==v35[1]||v87!==v35[2]){
  v1.stencilFunc(v85,v86,v87);
  v35[0]=v85;
  v35[1]=v86;
  v35[2]=v87;
  }
  v88=v36[0];
  v89=v36[1];
  v90=v36[2];
  v91=v36[3];
  if(v88!==v37[0]||v89!==v37[1]||v90!==v37[2]||v91!==v37[3]){
  v1.stencilOpSeparate(v88,v89,v90,v91);
  v37[0]=v88;
  v37[1]=v89;
  v37[2]=v90;
  v37[3]=v91;
  }
  v92=v38[0];
  v93=v38[1];
  v94=v38[2];
  v95=v38[3];
  if(v92!==v39[0]||v93!==v39[1]||v94!==v39[2]||v95!==v39[3]){
  v1.stencilOpSeparate(v92,v93,v94,v95);
  v39[0]=v92;
  v39[1]=v93;
  v39[2]=v94;
  v39[3]=v95;
  }
  }
  v96=a0["viewport"];
  if(!(v96&&typeof v96==="object"))g18.commandRaise(g97,g19);
  v98=v96.x|0;
  v99=v96.y|0;
  v100="width" in v96?v96.width|0:(v2.framebufferWidth-v98);
  v101="height" in v96?v96.height|0:(v2.framebufferHeight-v99);
  if(!(v100>=0&&v101>=0))g18.commandRaise(g97,g19);
  v102=v2.viewportWidth;
  v2.viewportWidth=v100;
  v103=v2.viewportHeight;
  v2.viewportHeight=v101;
  v1.viewport(v98,v99,v100,v101);
  v43[0]=v98;
  v43[1]=v99;
  v43[2]=v100;
  v43[3]=v101;
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[3];
  v104=a0["viewport"];
  if(!(v104&&typeof v104==="object"))g18.commandRaise(g105,g19);
  v106=v104.x|0;
  v107=v104.y|0;
  v108="width" in v104?v104.width|0:(v2.framebufferWidth-v106);
  v109="height" in v104?v104.height|0:(v2.framebufferHeight-v107);
  if(!(v108>=0&&v109>=0))g18.commandRaise(g105,g19);
  v1.scissor(v106,v107,v108,v109);
  v41[0]=v106;
  v41[1]=v107;
  v41[2]=v108;
  v41[3]=v109;
  if(_gs[4]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[5];
  v110=v5.profile;
  if(v110){
  v111=performance.now();
  g52.count++;
  }
  v1.useProgram(g112.program);
  v113=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v116=g115.location;
  v117=v10[v116];
  if(!v117.buffer){
  v1.enableVertexAttribArray(v116);
  }
  if(v117.type!==5126||v117.size!==2||v117.buffer!==g114||v117.normalized!==false||v117.offset!==16||v117.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v116,2,5126,false,24,16);
  v117.type=5126;
  v117.size=2;
  v117.buffer=g114;
  v117.normalized=false;
  v117.offset=16;
  v117.stride=24;
  }
  if(v117.divisor!==0){
  v113.vertexAttribDivisorANGLE(v116,0);
  v117.divisor=0;
  }
  v119=g118.call(this,v2,a0,0);
  v53.offset=v119;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g120,g19);
  v121=false;
  v122=1;
  v123=0;
  v124=0;
  v125=0;
  v126=0;
  v127=null;
  v128=0;
  v129=false;
  v130=5126;
  v131=0;
  v132=0;
  v133=0;
  if(v16(v53)){
  v121=true;
  v127=v8.createStream(34962,v53);
  v130=v127.dtype;
  }
  else{
  v127=v8.getBuffer(v53);
  if(v127){
  v130=v127.dtype;
  }
  else if("constant" in v53){
  v122=2;
  if(typeof v53.constant === "number"){
  v123=v53.constant;
  v124=v125=v126=0;
  }
  else{
  v123=v53.constant.length>0?v53.constant[0]:0;
  v124=v53.constant.length>1?v53.constant[1]:0;
  v125=v53.constant.length>2?v53.constant[2]:0;
  v126=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v127=v8.createStream(34962,v53.buffer);
  }
  else{
  v127=v8.getBuffer(v53.buffer);
  }
  v130="type" in v53?v49[v53.type]:v127.dtype;
  v129=!!v53.normalized;
  v128=v53.size|0;
  v131=v53.offset|0;
  v132=v53.stride|0;
  v133=v53.divisor|0;
  }
  }
  v135=g134.location;
  v136=v10[v135];
  if(v122===1){
  if(!v136.buffer){
  v1.enableVertexAttribArray(v135);
  }
  v137=v128||4;
  if(v136.type!==v130||v136.size!==v137||v136.buffer!==v127||v136.normalized!==v129||v136.offset!==v131||v136.stride!==v132){
  v1.bindBuffer(34962,v127.buffer);
  v1.vertexAttribPointer(v135,v137,v130,v129,v132,v131);
  v136.type=v130;
  v136.size=v137;
  v136.buffer=v127;
  v136.normalized=v129;
  v136.offset=v131;
  v136.stride=v132;
  }
  if(v136.divisor!==v133){
  v113.vertexAttribDivisorANGLE(v135,v133);
  v136.divisor=v133;
  }
  }
  else{
  if(v136.buffer){
  v1.disableVertexAttribArray(v135);
  v136.buffer=null;
  }
  if(v136.x!==v123||v136.y!==v124||v136.z!==v125||v136.w!==v126){
  v1.vertexAttrib4f(v135,v123,v124,v125,v126);
  v136.x=v123;
  v136.y=v124;
  v136.z=v125;
  v136.w=v126;
  }
  }
  v139=g138.location;
  v140=v10[v139];
  if(!v140.buffer){
  v1.enableVertexAttribArray(v139);
  }
  if(v140.type!==5126||v140.size!==2||v140.buffer!==g114||v140.normalized!==false||v140.offset!==0||v140.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v139,2,5126,false,24,0);
  v140.type=5126;
  v140.size=2;
  v140.buffer=g114;
  v140.normalized=false;
  v140.offset=0;
  v140.stride=24;
  }
  if(v140.divisor!==0){
  v113.vertexAttribDivisorANGLE(v139,0);
  v140.divisor=0;
  }
  v142=g141.call(this,v2,a0,0);
  v59.offset=v142;
  if(!(v59&&(typeof v59==="object"||typeof v59==="function")&&(v16(v59)||v8.getBuffer(v59)||v8.getBuffer(v59.buffer)||v16(v59.buffer)||("constant" in v59&&(typeof v59.constant==="number"||v17(v59.constant))))))g18.commandRaise(g143,g19);
  v144=false;
  v145=1;
  v146=0;
  v147=0;
  v148=0;
  v149=0;
  v150=null;
  v151=0;
  v152=false;
  v153=5126;
  v154=0;
  v155=0;
  v156=0;
  if(v16(v59)){
  v144=true;
  v150=v8.createStream(34962,v59);
  v153=v150.dtype;
  }
  else{
  v150=v8.getBuffer(v59);
  if(v150){
  v153=v150.dtype;
  }
  else if("constant" in v59){
  v145=2;
  if(typeof v59.constant === "number"){
  v146=v59.constant;
  v147=v148=v149=0;
  }
  else{
  v146=v59.constant.length>0?v59.constant[0]:0;
  v147=v59.constant.length>1?v59.constant[1]:0;
  v148=v59.constant.length>2?v59.constant[2]:0;
  v149=v59.constant.length>3?v59.constant[3]:0;
  }
  }
  else{
  if(v16(v59.buffer)){
  v150=v8.createStream(34962,v59.buffer);
  }
  else{
  v150=v8.getBuffer(v59.buffer);
  }
  v153="type" in v59?v49[v59.type]:v150.dtype;
  v152=!!v59.normalized;
  v151=v59.size|0;
  v154=v59.offset|0;
  v155=v59.stride|0;
  v156=v59.divisor|0;
  }
  }
  v158=g157.location;
  v159=v10[v158];
  if(v145===1){
  if(!v159.buffer){
  v1.enableVertexAttribArray(v158);
  }
  v160=v151||4;
  if(v159.type!==v153||v159.size!==v160||v159.buffer!==v150||v159.normalized!==v152||v159.offset!==v154||v159.stride!==v155){
  v1.bindBuffer(34962,v150.buffer);
  v1.vertexAttribPointer(v158,v160,v153,v152,v155,v154);
  v159.type=v153;
  v159.size=v160;
  v159.buffer=v150;
  v159.normalized=v152;
  v159.offset=v154;
  v159.stride=v155;
  }
  if(v159.divisor!==v156){
  v113.vertexAttribDivisorANGLE(v158,v156);
  v159.divisor=v156;
  }
  }
  else{
  if(v159.buffer){
  v1.disableVertexAttribArray(v158);
  v159.buffer=null;
  }
  if(v159.x!==v146||v159.y!==v147||v159.z!==v148||v159.w!==v149){
  v1.vertexAttrib4f(v158,v146,v147,v148,v149);
  v159.x=v146;
  v159.y=v147;
  v159.z=v148;
  v159.w=v149;
  }
  }
  v162=g161.location;
  v163=v10[v162];
  if(!v163.buffer){
  v1.enableVertexAttribArray(v162);
  }
  if(v163.type!==5126||v163.size!==2||v163.buffer!==g114||v163.normalized!==false||v163.offset!==8||v163.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v162,2,5126,false,24,8);
  v163.type=5126;
  v163.size=2;
  v163.buffer=g114;
  v163.normalized=false;
  v163.offset=8;
  v163.stride=24;
  }
  if(v163.divisor!==0){
  v113.vertexAttribDivisorANGLE(v162,0);
  v163.divisor=0;
  }
  v165=g164.call(this,v2,a0,0);
  v55.offset=v165;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g166,g19);
  v167=false;
  v168=1;
  v169=0;
  v170=0;
  v171=0;
  v172=0;
  v173=null;
  v174=0;
  v175=false;
  v176=5126;
  v177=0;
  v178=0;
  v179=0;
  if(v16(v55)){
  v167=true;
  v173=v8.createStream(34962,v55);
  v176=v173.dtype;
  }
  else{
  v173=v8.getBuffer(v55);
  if(v173){
  v176=v173.dtype;
  }
  else if("constant" in v55){
  v168=2;
  if(typeof v55.constant === "number"){
  v169=v55.constant;
  v170=v171=v172=0;
  }
  else{
  v169=v55.constant.length>0?v55.constant[0]:0;
  v170=v55.constant.length>1?v55.constant[1]:0;
  v171=v55.constant.length>2?v55.constant[2]:0;
  v172=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v173=v8.createStream(34962,v55.buffer);
  }
  else{
  v173=v8.getBuffer(v55.buffer);
  }
  v176="type" in v55?v49[v55.type]:v173.dtype;
  v175=!!v55.normalized;
  v174=v55.size|0;
  v177=v55.offset|0;
  v178=v55.stride|0;
  v179=v55.divisor|0;
  }
  }
  v181=g180.location;
  v182=v10[v181];
  if(v168===1){
  if(!v182.buffer){
  v1.enableVertexAttribArray(v181);
  }
  v183=v174||2;
  if(v182.type!==v176||v182.size!==v183||v182.buffer!==v173||v182.normalized!==v175||v182.offset!==v177||v182.stride!==v178){
  v1.bindBuffer(34962,v173.buffer);
  v1.vertexAttribPointer(v181,v183,v176,v175,v178,v177);
  v182.type=v176;
  v182.size=v183;
  v182.buffer=v173;
  v182.normalized=v175;
  v182.offset=v177;
  v182.stride=v178;
  }
  if(v182.divisor!==v179){
  v113.vertexAttribDivisorANGLE(v181,v179);
  v182.divisor=v179;
  }
  }
  else{
  if(v182.buffer){
  v1.disableVertexAttribArray(v181);
  v182.buffer=null;
  }
  if(v182.x!==v169||v182.y!==v170||v182.z!==v171||v182.w!==v172){
  v1.vertexAttrib4f(v181,v169,v170,v171,v172);
  v182.x=v169;
  v182.y=v170;
  v182.z=v171;
  v182.w=v172;
  }
  }
  v185=g184.call(this,v2,a0,0);
  v57.offset=v185;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g186,g19);
  v187=false;
  v188=1;
  v189=0;
  v190=0;
  v191=0;
  v192=0;
  v193=null;
  v194=0;
  v195=false;
  v196=5126;
  v197=0;
  v198=0;
  v199=0;
  if(v16(v57)){
  v187=true;
  v193=v8.createStream(34962,v57);
  v196=v193.dtype;
  }
  else{
  v193=v8.getBuffer(v57);
  if(v193){
  v196=v193.dtype;
  }
  else if("constant" in v57){
  v188=2;
  if(typeof v57.constant === "number"){
  v189=v57.constant;
  v190=v191=v192=0;
  }
  else{
  v189=v57.constant.length>0?v57.constant[0]:0;
  v190=v57.constant.length>1?v57.constant[1]:0;
  v191=v57.constant.length>2?v57.constant[2]:0;
  v192=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v193=v8.createStream(34962,v57.buffer);
  }
  else{
  v193=v8.getBuffer(v57.buffer);
  }
  v196="type" in v57?v49[v57.type]:v193.dtype;
  v195=!!v57.normalized;
  v194=v57.size|0;
  v197=v57.offset|0;
  v198=v57.stride|0;
  v199=v57.divisor|0;
  }
  }
  v201=g200.location;
  v202=v10[v201];
  if(v188===1){
  if(!v202.buffer){
  v1.enableVertexAttribArray(v201);
  }
  v203=v194||2;
  if(v202.type!==v196||v202.size!==v203||v202.buffer!==v193||v202.normalized!==v195||v202.offset!==v197||v202.stride!==v198){
  v1.bindBuffer(34962,v193.buffer);
  v1.vertexAttribPointer(v201,v203,v196,v195,v198,v197);
  v202.type=v196;
  v202.size=v203;
  v202.buffer=v193;
  v202.normalized=v195;
  v202.offset=v197;
  v202.stride=v198;
  }
  if(v202.divisor!==v199){
  v113.vertexAttribDivisorANGLE(v201,v199);
  v202.divisor=v199;
  }
  }
  else{
  if(v202.buffer){
  v1.disableVertexAttribArray(v201);
  v202.buffer=null;
  }
  if(v202.x!==v189||v202.y!==v190||v202.z!==v191||v202.w!==v192){
  v1.vertexAttrib4f(v201,v189,v190,v191,v192);
  v202.x=v189;
  v202.y=v190;
  v202.z=v191;
  v202.w=v192;
  }
  }
  v205=a0["capSize"];
  if(!(typeof v205==="number"))g18.commandRaise(g206,g19);
  v1.uniform1f(g204.location,v205);
  v208=a0["lineWidth"];
  if(!(typeof v208==="number"))g18.commandRaise(g209,g19);
  v1.uniform1f(g207.location,v208);
  v211=a0["opacity"];
  if(!(typeof v211==="number"))g18.commandRaise(g212,g19);
  v1.uniform1f(g210.location,v211);
  v214=a0["scale"];
  if(!(v17(v214)&&v214.length===2))g18.commandRaise(g215,g19);
  v216=v214[0];
  v217=v214[1];
  v1.uniform2f(g213.location,v216,v217);
  v219=a0["scaleFract"];
  if(!(v17(v219)&&v219.length===2))g18.commandRaise(g220,g19);
  v221=v219[0];
  v222=v219[1];
  v1.uniform2f(g218.location,v221,v222);
  v224=a0["translate"];
  if(!(v17(v224)&&v224.length===2))g18.commandRaise(g225,g19);
  v226=v224[0];
  v227=v224[1];
  v1.uniform2f(g223.location,v226,v227);
  v229=a0["translateFract"];
  if(!(v17(v229)&&v229.length===2))g18.commandRaise(g230,g19);
  v231=v229[0];
  v232=v229[1];
  v1.uniform2f(g228.location,v231,v232);
  v235=g234.call(this,v2,a0,0);
  if(!(v17(v235)&&v235.length===4))g18.commandRaise(g236,g19);
  v237=v235[0];
  v238=v235[1];
  v239=v235[2];
  v240=v235[3];
  v1.uniform4f(g233.location,v237,v238,v239,v240);
  v241=v6.elements;
  if(v241){
  v1.bindBuffer(34963,v241.buffer.buffer);
  }
  else if(v11.currentVAO){
  v241=v7.getElements(v11.currentVAO.elements);
  if(v241)v1.bindBuffer(34963,v241.buffer.buffer);
  }
  v242=v6.offset;
  v243=a0["count"];
  if(v243>0){
  if(v241){
  v113.drawElementsInstancedANGLE(4,36,v241.type,v242<<((v241.type-5121)>>1),v243);
  }
  else{
  v113.drawArraysInstancedANGLE(4,v242,36,v243);
  }
  }
  else if(v243<0){
  if(v241){
  v1.drawElements(4,36,v241.type,v242<<((v241.type-5121)>>1));
  }
  else{
  v1.drawArrays(4,v242,36);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v102;
  v2.viewportHeight=v103;
  if(v110){
  g52.cpuTime+=performance.now()-v111;
  }
  if(v121){
  v8.destroyStream(v127);
  }
  if(v144){
  v8.destroyStream(v150);
  }
  if(v167){
  v8.destroyStream(v173);
  }
  if(v187){
  v8.destroyStream(v193);
  }
  }
  ,"scope":function(a0,a1,a2){
  var v244,v245,v246,v247,v248,v249,v250,v251,v252,v253,v254,v255,v256,v257,v258,v259,v260,v261,v262,v263,v264,v265,v266,v267,v268,v269,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v290,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v302,v303,v304,v305,v306,v307,v308,v309,v310,v311,v312,v313,v315,v316,v317,v318,v319,v320,v321,v322,v323,v324,v325,v326,v328,v329,v330,v331,v332,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v348,v349,v350,v351,v352,v353,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v375,v376,v377,v378,v379,v380,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v403,v404,v405,v406,v407,v409,v410,v411,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v423,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v434,v436,v437,v438,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v449;
  v244=a0["viewport"];
  if(!(v244&&typeof v244==="object"))g18.commandRaise(g97,g19);
  v245=v244.x|0;
  v246=v244.y|0;
  v247="width" in v244?v244.width|0:(v2.framebufferWidth-v245);
  v248="height" in v244?v244.height|0:(v2.framebufferHeight-v246);
  if(!(v247>=0&&v248>=0))g18.commandRaise(g97,g19);
  v249=v2.viewportWidth;
  v2.viewportWidth=v247;
  v250=v2.viewportHeight;
  v2.viewportHeight=v248;
  v251=v42[0];
  v42[0]=_gs[6];
  v252=v42[1];
  v42[1]=_gs[7];
  v253=v42[2];
  v42[2]=_gs[8];
  v254=v42[3];
  v42[3]=_gs[9];
  v255=v20[0];
  v20[0]=_gs[10];
  v256=v20[1];
  v20[1]=_gs[11];
  v257=v20[2];
  v20[2]=_gs[12];
  v258=v20[3];
  v20[3]=_gs[13];
  v259=v4.blend_enable;
  v4.blend_enable=_gs[14];
  v260=v22[0];
  v22[0]=_gs[15];
  v261=v22[1];
  v22[1]=_gs[16];
  v262=v24[0];
  v24[0]=_gs[17];
  v263=v24[1];
  v24[1]=_gs[18];
  v264=v24[2];
  v24[2]=_gs[19];
  v265=v24[3];
  v24[3]=_gs[20];
  v266=v4.depth_enable;
  v4.depth_enable=_gs[21];
  v267=a0["viewport"];
  if(!(v267&&typeof v267==="object"))g18.commandRaise(g105,g19);
  v268=v267.x|0;
  v269=v267.y|0;
  v270="width" in v267?v267.width|0:(v2.framebufferWidth-v268);
  v271="height" in v267?v267.height|0:(v2.framebufferHeight-v269);
  if(!(v270>=0&&v271>=0))g18.commandRaise(g105,g19);
  v272=v40[0];
  v40[0]=_gs[22];
  v273=v40[1];
  v40[1]=_gs[23];
  v274=v40[2];
  v40[2]=_gs[24];
  v275=v40[3];
  v40[3]=_gs[25];
  v276=v4.scissor_enable;
  v4.scissor_enable=_gs[26];
  v277=v5.profile;
  if(v277){
  v278=performance.now();
  g52.count++;
  }
  v279=v6.count;
  v6.count=_gs[27];
  v280=a0["count"];
  v281=v6.instances;
  v6.instances=_gs[28];
  v282=v6.primitive;
  v6.primitive=_gs[29];
  v283=a0["range"];
  v284=v12[_gs[30]];
  v12[_gs[30]]=v283;
  v285=a0["lineWidth"];
  v286=v12[_gs[31]];
  v12[_gs[31]]=v285;
  v287=a0["capSize"];
  v288=v12[_gs[32]];
  v12[_gs[32]]=v287;
  v289=a0["opacity"];
  v290=v12[_gs[33]];
  v12[_gs[33]]=v289;
  v291=a0["scale"];
  v292=v12[_gs[34]];
  v12[_gs[34]]=v291;
  v293=a0["translate"];
  v294=v12[_gs[35]];
  v12[_gs[35]]=v293;
  v295=a0["scaleFract"];
  v296=v12[_gs[36]];
  v12[_gs[36]]=v295;
  v297=a0["translateFract"];
  v298=v12[_gs[37]];
  v12[_gs[37]]=v297;
  v299=g234.call(this,v2,a0,a2);
  v300=v12[_gs[38]];
  v12[_gs[38]]=v299;
  v302=g301.state;
  g301.state=1;
  v303=g301.x;
  g301.x=0;
  v304=g301.y;
  g301.y=0;
  v305=g301.z;
  g301.z=0;
  v306=g301.w;
  g301.w=0;
  v307=g301.buffer;
  g301.buffer=g114;
  v308=g301.size;
  g301.size=0;
  v309=g301.normalized;
  g301.normalized=false;
  v310=g301.type;
  g301.type=5126;
  v311=g301.offset;
  g301.offset=0;
  v312=g301.stride;
  g301.stride=24;
  v313=g301.divisor;
  g301.divisor=0;
  v315=g314.state;
  g314.state=1;
  v316=g314.x;
  g314.x=0;
  v317=g314.y;
  g314.y=0;
  v318=g314.z;
  g314.z=0;
  v319=g314.w;
  g314.w=0;
  v320=g314.buffer;
  g314.buffer=g114;
  v321=g314.size;
  g314.size=0;
  v322=g314.normalized;
  g314.normalized=false;
  v323=g314.type;
  g314.type=5126;
  v324=g314.offset;
  g314.offset=8;
  v325=g314.stride;
  g314.stride=24;
  v326=g314.divisor;
  g314.divisor=0;
  v328=g327.state;
  g327.state=1;
  v329=g327.x;
  g327.x=0;
  v330=g327.y;
  g327.y=0;
  v331=g327.z;
  g327.z=0;
  v332=g327.w;
  g327.w=0;
  v333=g327.buffer;
  g327.buffer=g114;
  v334=g327.size;
  g327.size=0;
  v335=g327.normalized;
  g327.normalized=false;
  v336=g327.type;
  g327.type=5126;
  v337=g327.offset;
  g327.offset=16;
  v338=g327.stride;
  g327.stride=24;
  v339=g327.divisor;
  g327.divisor=0;
  v340=g118.call(this,v2,a0,a2);
  v53.offset=v340;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g120,g19);
  v341=false;
  v342=1;
  v343=0;
  v344=0;
  v345=0;
  v346=0;
  v347=null;
  v348=0;
  v349=false;
  v350=5126;
  v351=0;
  v352=0;
  v353=0;
  if(v16(v53)){
  v341=true;
  v347=v8.createStream(34962,v53);
  v350=v347.dtype;
  }
  else{
  v347=v8.getBuffer(v53);
  if(v347){
  v350=v347.dtype;
  }
  else if("constant" in v53){
  v342=2;
  if(typeof v53.constant === "number"){
  v343=v53.constant;
  v344=v345=v346=0;
  }
  else{
  v343=v53.constant.length>0?v53.constant[0]:0;
  v344=v53.constant.length>1?v53.constant[1]:0;
  v345=v53.constant.length>2?v53.constant[2]:0;
  v346=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v347=v8.createStream(34962,v53.buffer);
  }
  else{
  v347=v8.getBuffer(v53.buffer);
  }
  v350="type" in v53?v49[v53.type]:v347.dtype;
  v349=!!v53.normalized;
  v348=v53.size|0;
  v351=v53.offset|0;
  v352=v53.stride|0;
  v353=v53.divisor|0;
  }
  }
  v355=g354.state;
  g354.state=v342;
  v356=g354.x;
  g354.x=v343;
  v357=g354.y;
  g354.y=v344;
  v358=g354.z;
  g354.z=v345;
  v359=g354.w;
  g354.w=v346;
  v360=g354.buffer;
  g354.buffer=v347;
  v361=g354.size;
  g354.size=v348;
  v362=g354.normalized;
  g354.normalized=v349;
  v363=g354.type;
  g354.type=v350;
  v364=g354.offset;
  g354.offset=v351;
  v365=g354.stride;
  g354.stride=v352;
  v366=g354.divisor;
  g354.divisor=v353;
  v367=g164.call(this,v2,a0,a2);
  v55.offset=v367;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g166,g19);
  v368=false;
  v369=1;
  v370=0;
  v371=0;
  v372=0;
  v373=0;
  v374=null;
  v375=0;
  v376=false;
  v377=5126;
  v378=0;
  v379=0;
  v380=0;
  if(v16(v55)){
  v368=true;
  v374=v8.createStream(34962,v55);
  v377=v374.dtype;
  }
  else{
  v374=v8.getBuffer(v55);
  if(v374){
  v377=v374.dtype;
  }
  else if("constant" in v55){
  v369=2;
  if(typeof v55.constant === "number"){
  v370=v55.constant;
  v371=v372=v373=0;
  }
  else{
  v370=v55.constant.length>0?v55.constant[0]:0;
  v371=v55.constant.length>1?v55.constant[1]:0;
  v372=v55.constant.length>2?v55.constant[2]:0;
  v373=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v374=v8.createStream(34962,v55.buffer);
  }
  else{
  v374=v8.getBuffer(v55.buffer);
  }
  v377="type" in v55?v49[v55.type]:v374.dtype;
  v376=!!v55.normalized;
  v375=v55.size|0;
  v378=v55.offset|0;
  v379=v55.stride|0;
  v380=v55.divisor|0;
  }
  }
  v382=g381.state;
  g381.state=v369;
  v383=g381.x;
  g381.x=v370;
  v384=g381.y;
  g381.y=v371;
  v385=g381.z;
  g381.z=v372;
  v386=g381.w;
  g381.w=v373;
  v387=g381.buffer;
  g381.buffer=v374;
  v388=g381.size;
  g381.size=v375;
  v389=g381.normalized;
  g381.normalized=v376;
  v390=g381.type;
  g381.type=v377;
  v391=g381.offset;
  g381.offset=v378;
  v392=g381.stride;
  g381.stride=v379;
  v393=g381.divisor;
  g381.divisor=v380;
  v394=g184.call(this,v2,a0,a2);
  v57.offset=v394;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g186,g19);
  v395=false;
  v396=1;
  v397=0;
  v398=0;
  v399=0;
  v400=0;
  v401=null;
  v402=0;
  v403=false;
  v404=5126;
  v405=0;
  v406=0;
  v407=0;
  if(v16(v57)){
  v395=true;
  v401=v8.createStream(34962,v57);
  v404=v401.dtype;
  }
  else{
  v401=v8.getBuffer(v57);
  if(v401){
  v404=v401.dtype;
  }
  else if("constant" in v57){
  v396=2;
  if(typeof v57.constant === "number"){
  v397=v57.constant;
  v398=v399=v400=0;
  }
  else{
  v397=v57.constant.length>0?v57.constant[0]:0;
  v398=v57.constant.length>1?v57.constant[1]:0;
  v399=v57.constant.length>2?v57.constant[2]:0;
  v400=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v401=v8.createStream(34962,v57.buffer);
  }
  else{
  v401=v8.getBuffer(v57.buffer);
  }
  v404="type" in v57?v49[v57.type]:v401.dtype;
  v403=!!v57.normalized;
  v402=v57.size|0;
  v405=v57.offset|0;
  v406=v57.stride|0;
  v407=v57.divisor|0;
  }
  }
  v409=g408.state;
  g408.state=v396;
  v410=g408.x;
  g408.x=v397;
  v411=g408.y;
  g408.y=v398;
  v412=g408.z;
  g408.z=v399;
  v413=g408.w;
  g408.w=v400;
  v414=g408.buffer;
  g408.buffer=v401;
  v415=g408.size;
  g408.size=v402;
  v416=g408.normalized;
  g408.normalized=v403;
  v417=g408.type;
  g408.type=v404;
  v418=g408.offset;
  g408.offset=v405;
  v419=g408.stride;
  g408.stride=v406;
  v420=g408.divisor;
  g408.divisor=v407;
  v421=g141.call(this,v2,a0,a2);
  v59.offset=v421;
  if(!(v59&&(typeof v59==="object"||typeof v59==="function")&&(v16(v59)||v8.getBuffer(v59)||v8.getBuffer(v59.buffer)||v16(v59.buffer)||("constant" in v59&&(typeof v59.constant==="number"||v17(v59.constant))))))g18.commandRaise(g143,g19);
  v422=false;
  v423=1;
  v424=0;
  v425=0;
  v426=0;
  v427=0;
  v428=null;
  v429=0;
  v430=false;
  v431=5126;
  v432=0;
  v433=0;
  v434=0;
  if(v16(v59)){
  v422=true;
  v428=v8.createStream(34962,v59);
  v431=v428.dtype;
  }
  else{
  v428=v8.getBuffer(v59);
  if(v428){
  v431=v428.dtype;
  }
  else if("constant" in v59){
  v423=2;
  if(typeof v59.constant === "number"){
  v424=v59.constant;
  v425=v426=v427=0;
  }
  else{
  v424=v59.constant.length>0?v59.constant[0]:0;
  v425=v59.constant.length>1?v59.constant[1]:0;
  v426=v59.constant.length>2?v59.constant[2]:0;
  v427=v59.constant.length>3?v59.constant[3]:0;
  }
  }
  else{
  if(v16(v59.buffer)){
  v428=v8.createStream(34962,v59.buffer);
  }
  else{
  v428=v8.getBuffer(v59.buffer);
  }
  v431="type" in v59?v49[v59.type]:v428.dtype;
  v430=!!v59.normalized;
  v429=v59.size|0;
  v432=v59.offset|0;
  v433=v59.stride|0;
  v434=v59.divisor|0;
  }
  }
  v436=g435.state;
  g435.state=v423;
  v437=g435.x;
  g435.x=v424;
  v438=g435.y;
  g435.y=v425;
  v439=g435.z;
  g435.z=v426;
  v440=g435.w;
  g435.w=v427;
  v441=g435.buffer;
  g435.buffer=v428;
  v442=g435.size;
  g435.size=v429;
  v443=g435.normalized;
  g435.normalized=v430;
  v444=g435.type;
  g435.type=v431;
  v445=g435.offset;
  g435.offset=v432;
  v446=g435.stride;
  g435.stride=v433;
  v447=g435.divisor;
  g435.divisor=v434;
  v448=v9.vert;
  v9.vert=_gs[39];
  v449=v9.frag;
  v9.frag=_gs[40];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v249;
  v2.viewportHeight=v250;
  v42[0]=v251;
  v42[1]=v252;
  v42[2]=v253;
  v42[3]=v254;
  v20[0]=v255;
  v20[1]=v256;
  v20[2]=v257;
  v20[3]=v258;
  v4.blend_enable=v259;
  v22[0]=v260;
  v22[1]=v261;
  v24[0]=v262;
  v24[1]=v263;
  v24[2]=v264;
  v24[3]=v265;
  v4.depth_enable=v266;
  v40[0]=v272;
  v40[1]=v273;
  v40[2]=v274;
  v40[3]=v275;
  v4.scissor_enable=v276;
  if(v277){
  g52.cpuTime+=performance.now()-v278;
  }
  v6.count=v279;
  v6.instances=v281;
  v6.primitive=v282;
  v12[_gs[30]]=v284;
  v12[_gs[31]]=v286;
  v12[_gs[32]]=v288;
  v12[_gs[33]]=v290;
  v12[_gs[34]]=v292;
  v12[_gs[35]]=v294;
  v12[_gs[36]]=v296;
  v12[_gs[37]]=v298;
  v12[_gs[38]]=v300;
  g301.state=v302;
  g301.x=v303;
  g301.y=v304;
  g301.z=v305;
  g301.w=v306;
  g301.buffer=v307;
  g301.size=v308;
  g301.normalized=v309;
  g301.type=v310;
  g301.offset=v311;
  g301.stride=v312;
  g301.divisor=v313;
  g314.state=v315;
  g314.x=v316;
  g314.y=v317;
  g314.z=v318;
  g314.w=v319;
  g314.buffer=v320;
  g314.size=v321;
  g314.normalized=v322;
  g314.type=v323;
  g314.offset=v324;
  g314.stride=v325;
  g314.divisor=v326;
  g327.state=v328;
  g327.x=v329;
  g327.y=v330;
  g327.z=v331;
  g327.w=v332;
  g327.buffer=v333;
  g327.size=v334;
  g327.normalized=v335;
  g327.type=v336;
  g327.offset=v337;
  g327.stride=v338;
  g327.divisor=v339;
  if(v341){
  v8.destroyStream(v347);
  }
  g354.state=v355;
  g354.x=v356;
  g354.y=v357;
  g354.z=v358;
  g354.w=v359;
  g354.buffer=v360;
  g354.size=v361;
  g354.normalized=v362;
  g354.type=v363;
  g354.offset=v364;
  g354.stride=v365;
  g354.divisor=v366;
  if(v368){
  v8.destroyStream(v374);
  }
  g381.state=v382;
  g381.x=v383;
  g381.y=v384;
  g381.z=v385;
  g381.w=v386;
  g381.buffer=v387;
  g381.size=v388;
  g381.normalized=v389;
  g381.type=v390;
  g381.offset=v391;
  g381.stride=v392;
  g381.divisor=v393;
  if(v395){
  v8.destroyStream(v401);
  }
  g408.state=v409;
  g408.x=v410;
  g408.y=v411;
  g408.z=v412;
  g408.w=v413;
  g408.buffer=v414;
  g408.size=v415;
  g408.normalized=v416;
  g408.type=v417;
  g408.offset=v418;
  g408.stride=v419;
  g408.divisor=v420;
  if(v422){
  v8.destroyStream(v428);
  }
  g435.state=v436;
  g435.x=v437;
  g435.y=v438;
  g435.z=v439;
  g435.w=v440;
  g435.buffer=v441;
  g435.size=v442;
  g435.normalized=v443;
  g435.type=v444;
  g435.offset=v445;
  g435.stride=v446;
  g435.divisor=v447;
  v9.vert=v448;
  v9.frag=v449;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v450,v451,v485,v486,v487,v488,v489;
  v450=v14.angle_instanced_arrays;
  v451=v13.next;
  if(v451!==v13.cur){
  if(v451){
  v1.bindFramebuffer(36160,v451.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v451;
  }
  if(v5.dirty){
  var v452,v453,v454,v455,v456,v457,v458,v459,v460,v461,v462,v463,v464,v465,v466,v467,v468,v469,v470,v471,v472,v473,v474,v475,v476,v477,v478,v479,v480,v481,v482,v483,v484;
  v452=v4.dither;
  if(v452!==v5.dither){
  if(v452){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v452;
  }
  v453=v4.depth_func;
  if(v453!==v5.depth_func){
  v1.depthFunc(v453);
  v5.depth_func=v453;
  }
  v454=v26[0];
  v455=v26[1];
  if(v454!==v27[0]||v455!==v27[1]){
  v1.depthRange(v454,v455);
  v27[0]=v454;
  v27[1]=v455;
  }
  v456=v4.depth_mask;
  if(v456!==v5.depth_mask){
  v1.depthMask(v456);
  v5.depth_mask=v456;
  }
  v457=v28[0];
  v458=v28[1];
  v459=v28[2];
  v460=v28[3];
  if(v457!==v29[0]||v458!==v29[1]||v459!==v29[2]||v460!==v29[3]){
  v1.colorMask(v457,v458,v459,v460);
  v29[0]=v457;
  v29[1]=v458;
  v29[2]=v459;
  v29[3]=v460;
  }
  v461=v4.cull_enable;
  if(v461!==v5.cull_enable){
  if(v461){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v461;
  }
  v462=v4.cull_face;
  if(v462!==v5.cull_face){
  v1.cullFace(v462);
  v5.cull_face=v462;
  }
  v463=v4.frontFace;
  if(v463!==v5.frontFace){
  v1.frontFace(v463);
  v5.frontFace=v463;
  }
  v464=v4.lineWidth;
  if(v464!==v5.lineWidth){
  v1.lineWidth(v464);
  v5.lineWidth=v464;
  }
  v465=v4.polygonOffset_enable;
  if(v465!==v5.polygonOffset_enable){
  if(v465){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v465;
  }
  v466=v30[0];
  v467=v30[1];
  if(v466!==v31[0]||v467!==v31[1]){
  v1.polygonOffset(v466,v467);
  v31[0]=v466;
  v31[1]=v467;
  }
  v468=v4.sample_alpha;
  if(v468!==v5.sample_alpha){
  if(v468){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v468;
  }
  v469=v4.sample_enable;
  if(v469!==v5.sample_enable){
  if(v469){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v469;
  }
  v470=v32[0];
  v471=v32[1];
  if(v470!==v33[0]||v471!==v33[1]){
  v1.sampleCoverage(v470,v471);
  v33[0]=v470;
  v33[1]=v471;
  }
  v472=v4.stencil_enable;
  if(v472!==v5.stencil_enable){
  if(v472){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v472;
  }
  v473=v4.stencil_mask;
  if(v473!==v5.stencil_mask){
  v1.stencilMask(v473);
  v5.stencil_mask=v473;
  }
  v474=v34[0];
  v475=v34[1];
  v476=v34[2];
  if(v474!==v35[0]||v475!==v35[1]||v476!==v35[2]){
  v1.stencilFunc(v474,v475,v476);
  v35[0]=v474;
  v35[1]=v475;
  v35[2]=v476;
  }
  v477=v36[0];
  v478=v36[1];
  v479=v36[2];
  v480=v36[3];
  if(v477!==v37[0]||v478!==v37[1]||v479!==v37[2]||v480!==v37[3]){
  v1.stencilOpSeparate(v477,v478,v479,v480);
  v37[0]=v477;
  v37[1]=v478;
  v37[2]=v479;
  v37[3]=v480;
  }
  v481=v38[0];
  v482=v38[1];
  v483=v38[2];
  v484=v38[3];
  if(v481!==v39[0]||v482!==v39[1]||v483!==v39[2]||v484!==v39[3]){
  v1.stencilOpSeparate(v481,v482,v483,v484);
  v39[0]=v481;
  v39[1]=v482;
  v39[2]=v483;
  v39[3]=v484;
  }
  }
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[41]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[42];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[43]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[44];
  if(_gs[45]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[46];
  v485=v5.profile;
  if(v485){
  v486=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g112.program);
  v487=v14.angle_instanced_arrays;
  var v502,v503,v504,v505,v506,v507,v611,v612;
  v11.setVAO(null);
  v502=g115.location;
  v503=v10[v502];
  if(!v503.buffer){
  v1.enableVertexAttribArray(v502);
  }
  if(v503.type!==5126||v503.size!==2||v503.buffer!==g114||v503.normalized!==false||v503.offset!==16||v503.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v502,2,5126,false,24,16);
  v503.type=5126;
  v503.size=2;
  v503.buffer=g114;
  v503.normalized=false;
  v503.offset=16;
  v503.stride=24;
  }
  if(v503.divisor!==0){
  v487.vertexAttribDivisorANGLE(v502,0);
  v503.divisor=0;
  }
  v504=g138.location;
  v505=v10[v504];
  if(!v505.buffer){
  v1.enableVertexAttribArray(v504);
  }
  if(v505.type!==5126||v505.size!==2||v505.buffer!==g114||v505.normalized!==false||v505.offset!==0||v505.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v504,2,5126,false,24,0);
  v505.type=5126;
  v505.size=2;
  v505.buffer=g114;
  v505.normalized=false;
  v505.offset=0;
  v505.stride=24;
  }
  if(v505.divisor!==0){
  v487.vertexAttribDivisorANGLE(v504,0);
  v505.divisor=0;
  }
  v506=g161.location;
  v507=v10[v506];
  if(!v507.buffer){
  v1.enableVertexAttribArray(v506);
  }
  if(v507.type!==5126||v507.size!==2||v507.buffer!==g114||v507.normalized!==false||v507.offset!==8||v507.stride!==24){
  v1.bindBuffer(34962,g114.buffer);
  v1.vertexAttribPointer(v506,2,5126,false,24,8);
  v507.type=5126;
  v507.size=2;
  v507.buffer=g114;
  v507.normalized=false;
  v507.offset=8;
  v507.stride=24;
  }
  if(v507.divisor!==0){
  v487.vertexAttribDivisorANGLE(v506,0);
  v507.divisor=0;
  }
  v611=v6.elements;
  if(v611){
  v1.bindBuffer(34963,v611.buffer.buffer);
  }
  else if(v11.currentVAO){
  v611=v7.getElements(v11.currentVAO.elements);
  if(v611)v1.bindBuffer(34963,v611.buffer.buffer);
  }
  v612=v6.offset;
  for(v488=0;
  v488<a1;
  ++v488){
  v489=a0[v488];
  var v490,v491,v492,v493,v494,v495,v496,v497,v498,v499,v500,v501,v508,v509,v510,v511,v512,v513,v514,v515,v516,v517,v518,v519,v520,v521,v522,v523,v524,v525,v526,v527,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537,v538,v539,v540,v541,v542,v543,v544,v545,v546,v547,v548,v549,v550,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v569,v570,v571,v572,v573,v574,v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v586,v587,v588,v589,v590,v591,v592,v593,v594,v595,v596,v597,v598,v599,v600,v601,v602,v603,v604,v605,v606,v607,v608,v609,v610,v613;
  v490=v489["viewport"];
  if(!(v490&&typeof v490==="object"))g18.commandRaise(g97,g19);
  v491=v490.x|0;
  v492=v490.y|0;
  v493="width" in v490?v490.width|0:(v2.framebufferWidth-v491);
  v494="height" in v490?v490.height|0:(v2.framebufferHeight-v492);
  if(!(v493>=0&&v494>=0))g18.commandRaise(g97,g19);
  v495=v2.viewportWidth;
  v2.viewportWidth=v493;
  v496=v2.viewportHeight;
  v2.viewportHeight=v494;
  v1.viewport(v491,v492,v493,v494);
  v43[0]=v491;
  v43[1]=v492;
  v43[2]=v493;
  v43[3]=v494;
  v497=v489["viewport"];
  if(!(v497&&typeof v497==="object"))g18.commandRaise(g105,g19);
  v498=v497.x|0;
  v499=v497.y|0;
  v500="width" in v497?v497.width|0:(v2.framebufferWidth-v498);
  v501="height" in v497?v497.height|0:(v2.framebufferHeight-v499);
  if(!(v500>=0&&v501>=0))g18.commandRaise(g105,g19);
  v1.scissor(v498,v499,v500,v501);
  v41[0]=v498;
  v41[1]=v499;
  v41[2]=v500;
  v41[3]=v501;
  v508=g118.call(this,v2,v489,v488);
  v53.offset=v508;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g120,g19);
  v509=false;
  v510=1;
  v511=0;
  v512=0;
  v513=0;
  v514=0;
  v515=null;
  v516=0;
  v517=false;
  v518=5126;
  v519=0;
  v520=0;
  v521=0;
  if(v16(v53)){
  v509=true;
  v515=v8.createStream(34962,v53);
  v518=v515.dtype;
  }
  else{
  v515=v8.getBuffer(v53);
  if(v515){
  v518=v515.dtype;
  }
  else if("constant" in v53){
  v510=2;
  if(typeof v53.constant === "number"){
  v511=v53.constant;
  v512=v513=v514=0;
  }
  else{
  v511=v53.constant.length>0?v53.constant[0]:0;
  v512=v53.constant.length>1?v53.constant[1]:0;
  v513=v53.constant.length>2?v53.constant[2]:0;
  v514=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v515=v8.createStream(34962,v53.buffer);
  }
  else{
  v515=v8.getBuffer(v53.buffer);
  }
  v518="type" in v53?v49[v53.type]:v515.dtype;
  v517=!!v53.normalized;
  v516=v53.size|0;
  v519=v53.offset|0;
  v520=v53.stride|0;
  v521=v53.divisor|0;
  }
  }
  v522=g134.location;
  v523=v10[v522];
  if(v510===1){
  if(!v523.buffer){
  v1.enableVertexAttribArray(v522);
  }
  v524=v516||4;
  if(v523.type!==v518||v523.size!==v524||v523.buffer!==v515||v523.normalized!==v517||v523.offset!==v519||v523.stride!==v520){
  v1.bindBuffer(34962,v515.buffer);
  v1.vertexAttribPointer(v522,v524,v518,v517,v520,v519);
  v523.type=v518;
  v523.size=v524;
  v523.buffer=v515;
  v523.normalized=v517;
  v523.offset=v519;
  v523.stride=v520;
  }
  if(v523.divisor!==v521){
  v487.vertexAttribDivisorANGLE(v522,v521);
  v523.divisor=v521;
  }
  }
  else{
  if(v523.buffer){
  v1.disableVertexAttribArray(v522);
  v523.buffer=null;
  }
  if(v523.x!==v511||v523.y!==v512||v523.z!==v513||v523.w!==v514){
  v1.vertexAttrib4f(v522,v511,v512,v513,v514);
  v523.x=v511;
  v523.y=v512;
  v523.z=v513;
  v523.w=v514;
  }
  }
  v525=g141.call(this,v2,v489,v488);
  v59.offset=v525;
  if(!(v59&&(typeof v59==="object"||typeof v59==="function")&&(v16(v59)||v8.getBuffer(v59)||v8.getBuffer(v59.buffer)||v16(v59.buffer)||("constant" in v59&&(typeof v59.constant==="number"||v17(v59.constant))))))g18.commandRaise(g143,g19);
  v526=false;
  v527=1;
  v528=0;
  v529=0;
  v530=0;
  v531=0;
  v532=null;
  v533=0;
  v534=false;
  v535=5126;
  v536=0;
  v537=0;
  v538=0;
  if(v16(v59)){
  v526=true;
  v532=v8.createStream(34962,v59);
  v535=v532.dtype;
  }
  else{
  v532=v8.getBuffer(v59);
  if(v532){
  v535=v532.dtype;
  }
  else if("constant" in v59){
  v527=2;
  if(typeof v59.constant === "number"){
  v528=v59.constant;
  v529=v530=v531=0;
  }
  else{
  v528=v59.constant.length>0?v59.constant[0]:0;
  v529=v59.constant.length>1?v59.constant[1]:0;
  v530=v59.constant.length>2?v59.constant[2]:0;
  v531=v59.constant.length>3?v59.constant[3]:0;
  }
  }
  else{
  if(v16(v59.buffer)){
  v532=v8.createStream(34962,v59.buffer);
  }
  else{
  v532=v8.getBuffer(v59.buffer);
  }
  v535="type" in v59?v49[v59.type]:v532.dtype;
  v534=!!v59.normalized;
  v533=v59.size|0;
  v536=v59.offset|0;
  v537=v59.stride|0;
  v538=v59.divisor|0;
  }
  }
  v539=g157.location;
  v540=v10[v539];
  if(v527===1){
  if(!v540.buffer){
  v1.enableVertexAttribArray(v539);
  }
  v541=v533||4;
  if(v540.type!==v535||v540.size!==v541||v540.buffer!==v532||v540.normalized!==v534||v540.offset!==v536||v540.stride!==v537){
  v1.bindBuffer(34962,v532.buffer);
  v1.vertexAttribPointer(v539,v541,v535,v534,v537,v536);
  v540.type=v535;
  v540.size=v541;
  v540.buffer=v532;
  v540.normalized=v534;
  v540.offset=v536;
  v540.stride=v537;
  }
  if(v540.divisor!==v538){
  v487.vertexAttribDivisorANGLE(v539,v538);
  v540.divisor=v538;
  }
  }
  else{
  if(v540.buffer){
  v1.disableVertexAttribArray(v539);
  v540.buffer=null;
  }
  if(v540.x!==v528||v540.y!==v529||v540.z!==v530||v540.w!==v531){
  v1.vertexAttrib4f(v539,v528,v529,v530,v531);
  v540.x=v528;
  v540.y=v529;
  v540.z=v530;
  v540.w=v531;
  }
  }
  v542=g164.call(this,v2,v489,v488);
  v55.offset=v542;
  if(!(v55&&(typeof v55==="object"||typeof v55==="function")&&(v16(v55)||v8.getBuffer(v55)||v8.getBuffer(v55.buffer)||v16(v55.buffer)||("constant" in v55&&(typeof v55.constant==="number"||v17(v55.constant))))))g18.commandRaise(g166,g19);
  v543=false;
  v544=1;
  v545=0;
  v546=0;
  v547=0;
  v548=0;
  v549=null;
  v550=0;
  v551=false;
  v552=5126;
  v553=0;
  v554=0;
  v555=0;
  if(v16(v55)){
  v543=true;
  v549=v8.createStream(34962,v55);
  v552=v549.dtype;
  }
  else{
  v549=v8.getBuffer(v55);
  if(v549){
  v552=v549.dtype;
  }
  else if("constant" in v55){
  v544=2;
  if(typeof v55.constant === "number"){
  v545=v55.constant;
  v546=v547=v548=0;
  }
  else{
  v545=v55.constant.length>0?v55.constant[0]:0;
  v546=v55.constant.length>1?v55.constant[1]:0;
  v547=v55.constant.length>2?v55.constant[2]:0;
  v548=v55.constant.length>3?v55.constant[3]:0;
  }
  }
  else{
  if(v16(v55.buffer)){
  v549=v8.createStream(34962,v55.buffer);
  }
  else{
  v549=v8.getBuffer(v55.buffer);
  }
  v552="type" in v55?v49[v55.type]:v549.dtype;
  v551=!!v55.normalized;
  v550=v55.size|0;
  v553=v55.offset|0;
  v554=v55.stride|0;
  v555=v55.divisor|0;
  }
  }
  v556=g180.location;
  v557=v10[v556];
  if(v544===1){
  if(!v557.buffer){
  v1.enableVertexAttribArray(v556);
  }
  v558=v550||2;
  if(v557.type!==v552||v557.size!==v558||v557.buffer!==v549||v557.normalized!==v551||v557.offset!==v553||v557.stride!==v554){
  v1.bindBuffer(34962,v549.buffer);
  v1.vertexAttribPointer(v556,v558,v552,v551,v554,v553);
  v557.type=v552;
  v557.size=v558;
  v557.buffer=v549;
  v557.normalized=v551;
  v557.offset=v553;
  v557.stride=v554;
  }
  if(v557.divisor!==v555){
  v487.vertexAttribDivisorANGLE(v556,v555);
  v557.divisor=v555;
  }
  }
  else{
  if(v557.buffer){
  v1.disableVertexAttribArray(v556);
  v557.buffer=null;
  }
  if(v557.x!==v545||v557.y!==v546||v557.z!==v547||v557.w!==v548){
  v1.vertexAttrib4f(v556,v545,v546,v547,v548);
  v557.x=v545;
  v557.y=v546;
  v557.z=v547;
  v557.w=v548;
  }
  }
  v559=g184.call(this,v2,v489,v488);
  v57.offset=v559;
  if(!(v57&&(typeof v57==="object"||typeof v57==="function")&&(v16(v57)||v8.getBuffer(v57)||v8.getBuffer(v57.buffer)||v16(v57.buffer)||("constant" in v57&&(typeof v57.constant==="number"||v17(v57.constant))))))g18.commandRaise(g186,g19);
  v560=false;
  v561=1;
  v562=0;
  v563=0;
  v564=0;
  v565=0;
  v566=null;
  v567=0;
  v568=false;
  v569=5126;
  v570=0;
  v571=0;
  v572=0;
  if(v16(v57)){
  v560=true;
  v566=v8.createStream(34962,v57);
  v569=v566.dtype;
  }
  else{
  v566=v8.getBuffer(v57);
  if(v566){
  v569=v566.dtype;
  }
  else if("constant" in v57){
  v561=2;
  if(typeof v57.constant === "number"){
  v562=v57.constant;
  v563=v564=v565=0;
  }
  else{
  v562=v57.constant.length>0?v57.constant[0]:0;
  v563=v57.constant.length>1?v57.constant[1]:0;
  v564=v57.constant.length>2?v57.constant[2]:0;
  v565=v57.constant.length>3?v57.constant[3]:0;
  }
  }
  else{
  if(v16(v57.buffer)){
  v566=v8.createStream(34962,v57.buffer);
  }
  else{
  v566=v8.getBuffer(v57.buffer);
  }
  v569="type" in v57?v49[v57.type]:v566.dtype;
  v568=!!v57.normalized;
  v567=v57.size|0;
  v570=v57.offset|0;
  v571=v57.stride|0;
  v572=v57.divisor|0;
  }
  }
  v573=g200.location;
  v574=v10[v573];
  if(v561===1){
  if(!v574.buffer){
  v1.enableVertexAttribArray(v573);
  }
  v575=v567||2;
  if(v574.type!==v569||v574.size!==v575||v574.buffer!==v566||v574.normalized!==v568||v574.offset!==v570||v574.stride!==v571){
  v1.bindBuffer(34962,v566.buffer);
  v1.vertexAttribPointer(v573,v575,v569,v568,v571,v570);
  v574.type=v569;
  v574.size=v575;
  v574.buffer=v566;
  v574.normalized=v568;
  v574.offset=v570;
  v574.stride=v571;
  }
  if(v574.divisor!==v572){
  v487.vertexAttribDivisorANGLE(v573,v572);
  v574.divisor=v572;
  }
  }
  else{
  if(v574.buffer){
  v1.disableVertexAttribArray(v573);
  v574.buffer=null;
  }
  if(v574.x!==v562||v574.y!==v563||v574.z!==v564||v574.w!==v565){
  v1.vertexAttrib4f(v573,v562,v563,v564,v565);
  v574.x=v562;
  v574.y=v563;
  v574.z=v564;
  v574.w=v565;
  }
  }
  v576=v489["capSize"];
  if(!(typeof v576==="number"))g18.commandRaise(g206,g19);
  if(!v488||v577!==v576){
  v577=v576;
  v1.uniform1f(g204.location,v576);
  }
  v578=v489["lineWidth"];
  if(!(typeof v578==="number"))g18.commandRaise(g209,g19);
  if(!v488||v579!==v578){
  v579=v578;
  v1.uniform1f(g207.location,v578);
  }
  v580=v489["opacity"];
  if(!(typeof v580==="number"))g18.commandRaise(g212,g19);
  if(!v488||v581!==v580){
  v581=v580;
  v1.uniform1f(g210.location,v580);
  }
  v582=v489["scale"];
  if(!(v17(v582)&&v582.length===2))g18.commandRaise(g215,g19);
  v583=v582[0];
  v585=v582[1];
  if(!v488||v584!==v583||v586!==v585){
  v584=v583;
  v586=v585;
  v1.uniform2f(g213.location,v583,v585);
  }
  v587=v489["scaleFract"];
  if(!(v17(v587)&&v587.length===2))g18.commandRaise(g220,g19);
  v588=v587[0];
  v590=v587[1];
  if(!v488||v589!==v588||v591!==v590){
  v589=v588;
  v591=v590;
  v1.uniform2f(g218.location,v588,v590);
  }
  v592=v489["translate"];
  if(!(v17(v592)&&v592.length===2))g18.commandRaise(g225,g19);
  v593=v592[0];
  v595=v592[1];
  if(!v488||v594!==v593||v596!==v595){
  v594=v593;
  v596=v595;
  v1.uniform2f(g223.location,v593,v595);
  }
  v597=v489["translateFract"];
  if(!(v17(v597)&&v597.length===2))g18.commandRaise(g230,g19);
  v598=v597[0];
  v600=v597[1];
  if(!v488||v599!==v598||v601!==v600){
  v599=v598;
  v601=v600;
  v1.uniform2f(g228.location,v598,v600);
  }
  v602=g234.call(this,v2,v489,v488);
  if(!(v17(v602)&&v602.length===4))g18.commandRaise(g236,g19);
  v603=v602[0];
  v605=v602[1];
  v607=v602[2];
  v609=v602[3];
  if(!v488||v604!==v603||v606!==v605||v608!==v607||v610!==v609){
  v604=v603;
  v606=v605;
  v608=v607;
  v610=v609;
  v1.uniform4f(g233.location,v603,v605,v607,v609);
  }
  v613=v489["count"];
  if(v613>0){
  if(v611){
  v487.drawElementsInstancedANGLE(4,36,v611.type,v612<<((v611.type-5121)>>1),v613);
  }
  else{
  v487.drawArraysInstancedANGLE(4,v612,36,v613);
  }
  }
  else if(v613<0){
  if(v611){
  v1.drawElements(4,36,v611.type,v612<<((v611.type-5121)>>1));
  }
  else{
  v1.drawArrays(4,v612,36);
  }
  }
  v2.viewportWidth=v495;
  v2.viewportHeight=v496;
  if(v509){
  v8.destroyStream(v515);
  }
  if(v526){
  v8.destroyStream(v532);
  }
  if(v543){
  v8.destroyStream(v549);
  }
  if(v560){
  v8.destroyStream(v566);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v485){
  g52.cpuTime+=performance.now()-v486;
  }
  }
  ,}
  
  },
  "43931.248": function (_gs, g0, g18, g19, g52, g97, g106, g109, g123, g128, g142, g147, g161, g166, g180, g184, g186, g187, g188, g190, g192, g193, g195, g198, g199, g201, g204, g206, g207, g208, g210, g211, g213, g218, g219, g221, g222, g224, g225, g227, g230, g232, g235, g237, g240, g242, g249, g251, g322, g349, g376, g403) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v54;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v53.offset=4;
  v53.stride=8;
  v54={
  }
  ;
  v54.offset=0;
  v54.stride=8;
  return {
  "draw":function(a0){
  var v55,v56,v96,v98,v99,v100,v101,v102,v103,v104,v105,v107,v108,v110,v111,v112,v113,v114,v115,v116,v117,v118,v119,v120,v121,v122,v124,v125,v126,v127,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,v143,v144,v145,v146,v148,v149,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v162,v163,v164,v165,v167,v168,v169,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v181,v182,v183,v185,v189,v191,v194,v196,v197,v200,v202,v203,v205,v209,v212,v214,v215,v216,v217,v220,v223,v226,v228,v229,v231,v233,v234,v236,v238,v239,v241,v243,v244,v245,v246,v247,v248,v250,v252;
  v55=v14.angle_instanced_arrays;
  v56=v13.next;
  if(v56!==v13.cur){
  if(v56){
  v1.bindFramebuffer(36160,v56.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v56;
  }
  if(v5.dirty){
  var v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95;
  v57=v4.dither;
  if(v57!==v5.dither){
  if(v57){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v57;
  }
  v58=v22[0];
  v59=v22[1];
  if(v58!==v23[0]||v59!==v23[1]){
  v1.blendEquationSeparate(v58,v59);
  v23[0]=v58;
  v23[1]=v59;
  }
  v60=v4.depth_func;
  if(v60!==v5.depth_func){
  v1.depthFunc(v60);
  v5.depth_func=v60;
  }
  v61=v26[0];
  v62=v26[1];
  if(v61!==v27[0]||v62!==v27[1]){
  v1.depthRange(v61,v62);
  v27[0]=v61;
  v27[1]=v62;
  }
  v63=v4.depth_mask;
  if(v63!==v5.depth_mask){
  v1.depthMask(v63);
  v5.depth_mask=v63;
  }
  v64=v28[0];
  v65=v28[1];
  v66=v28[2];
  v67=v28[3];
  if(v64!==v29[0]||v65!==v29[1]||v66!==v29[2]||v67!==v29[3]){
  v1.colorMask(v64,v65,v66,v67);
  v29[0]=v64;
  v29[1]=v65;
  v29[2]=v66;
  v29[3]=v67;
  }
  v68=v4.cull_enable;
  if(v68!==v5.cull_enable){
  if(v68){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v68;
  }
  v69=v4.cull_face;
  if(v69!==v5.cull_face){
  v1.cullFace(v69);
  v5.cull_face=v69;
  }
  v70=v4.frontFace;
  if(v70!==v5.frontFace){
  v1.frontFace(v70);
  v5.frontFace=v70;
  }
  v71=v4.lineWidth;
  if(v71!==v5.lineWidth){
  v1.lineWidth(v71);
  v5.lineWidth=v71;
  }
  v72=v4.polygonOffset_enable;
  if(v72!==v5.polygonOffset_enable){
  if(v72){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v72;
  }
  v73=v30[0];
  v74=v30[1];
  if(v73!==v31[0]||v74!==v31[1]){
  v1.polygonOffset(v73,v74);
  v31[0]=v73;
  v31[1]=v74;
  }
  v75=v4.sample_alpha;
  if(v75!==v5.sample_alpha){
  if(v75){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v75;
  }
  v76=v4.sample_enable;
  if(v76!==v5.sample_enable){
  if(v76){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v76;
  }
  v77=v32[0];
  v78=v32[1];
  if(v77!==v33[0]||v78!==v33[1]){
  v1.sampleCoverage(v77,v78);
  v33[0]=v77;
  v33[1]=v78;
  }
  v79=v4.stencil_mask;
  if(v79!==v5.stencil_mask){
  v1.stencilMask(v79);
  v5.stencil_mask=v79;
  }
  v80=v34[0];
  v81=v34[1];
  v82=v34[2];
  if(v80!==v35[0]||v81!==v35[1]||v82!==v35[2]){
  v1.stencilFunc(v80,v81,v82);
  v35[0]=v80;
  v35[1]=v81;
  v35[2]=v82;
  }
  v83=v36[0];
  v84=v36[1];
  v85=v36[2];
  v86=v36[3];
  if(v83!==v37[0]||v84!==v37[1]||v85!==v37[2]||v86!==v37[3]){
  v1.stencilOpSeparate(v83,v84,v85,v86);
  v37[0]=v83;
  v37[1]=v84;
  v37[2]=v85;
  v37[3]=v86;
  }
  v87=v38[0];
  v88=v38[1];
  v89=v38[2];
  v90=v38[3];
  if(v87!==v39[0]||v88!==v39[1]||v89!==v39[2]||v90!==v39[3]){
  v1.stencilOpSeparate(v87,v88,v89,v90);
  v39[0]=v87;
  v39[1]=v88;
  v39[2]=v89;
  v39[3]=v90;
  }
  v91=v4.scissor_enable;
  if(v91!==v5.scissor_enable){
  if(v91){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v91;
  }
  v92=v40[0];
  v93=v40[1];
  v94=v40[2];
  v95=v40[3];
  if(v92!==v41[0]||v93!==v41[1]||v94!==v41[2]||v95!==v41[3]){
  v1.scissor(v92,v93,v94,v95);
  v41[0]=v92;
  v41[1]=v93;
  v41[2]=v94;
  v41[3]=v95;
  }
  }
  v96=this["viewport"];
  if(!(v96&&typeof v96==="object"))g18.commandRaise(g97,g19);
  v98=v96.x|0;
  v99=v96.y|0;
  v100="width" in v96?v96.width|0:(v2.framebufferWidth-v98);
  v101="height" in v96?v96.height|0:(v2.framebufferHeight-v99);
  if(!(v100>=0&&v101>=0))g18.commandRaise(g97,g19);
  v102=v2.viewportWidth;
  v2.viewportWidth=v100;
  v103=v2.viewportHeight;
  v2.viewportHeight=v101;
  v1.viewport(v98,v99,v100,v101);
  v43[0]=v98;
  v43[1]=v99;
  v43[2]=v100;
  v43[3]=v101;
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[3];
  if(_gs[4]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[5];
  v104=v5.profile;
  if(v104){
  v105=performance.now();
  g52.count++;
  }
  v1.useProgram(g106.program);
  v107=v14.angle_instanced_arrays;
  v11.setVAO(null);
  v108=this["charBuffer"];
  if(!(v108&&(typeof v108==="object"||typeof v108==="function")&&(v16(v108)||v8.getBuffer(v108)||v8.getBuffer(v108.buffer)||v16(v108.buffer)||("constant" in v108&&(typeof v108.constant==="number"||v17(v108.constant))))))g18.commandRaise(g109,g19);
  v110=false;
  v111=1;
  v112=0;
  v113=0;
  v114=0;
  v115=0;
  v116=null;
  v117=0;
  v118=false;
  v119=5126;
  v120=0;
  v121=0;
  v122=0;
  if(v16(v108)){
  v110=true;
  v116=v8.createStream(34962,v108);
  v119=v116.dtype;
  }
  else{
  v116=v8.getBuffer(v108);
  if(v116){
  v119=v116.dtype;
  }
  else if("constant" in v108){
  v111=2;
  if(typeof v108.constant === "number"){
  v112=v108.constant;
  v113=v114=v115=0;
  }
  else{
  v112=v108.constant.length>0?v108.constant[0]:0;
  v113=v108.constant.length>1?v108.constant[1]:0;
  v114=v108.constant.length>2?v108.constant[2]:0;
  v115=v108.constant.length>3?v108.constant[3]:0;
  }
  }
  else{
  if(v16(v108.buffer)){
  v116=v8.createStream(34962,v108.buffer);
  }
  else{
  v116=v8.getBuffer(v108.buffer);
  }
  v119="type" in v108?v49[v108.type]:v116.dtype;
  v118=!!v108.normalized;
  v117=v108.size|0;
  v120=v108.offset|0;
  v121=v108.stride|0;
  v122=v108.divisor|0;
  }
  }
  v124=g123.location;
  v125=v10[v124];
  if(v111===1){
  if(!v125.buffer){
  v1.enableVertexAttribArray(v124);
  }
  v126=v117||1;
  if(v125.type!==v119||v125.size!==v126||v125.buffer!==v116||v125.normalized!==v118||v125.offset!==v120||v125.stride!==v121){
  v1.bindBuffer(34962,v116.buffer);
  v1.vertexAttribPointer(v124,v126,v119,v118,v121,v120);
  v125.type=v119;
  v125.size=v126;
  v125.buffer=v116;
  v125.normalized=v118;
  v125.offset=v120;
  v125.stride=v121;
  }
  if(v125.divisor!==v122){
  v107.vertexAttribDivisorANGLE(v124,v122);
  v125.divisor=v122;
  }
  }
  else{
  if(v125.buffer){
  v1.disableVertexAttribArray(v124);
  v125.buffer=null;
  }
  if(v125.x!==v112||v125.y!==v113||v125.z!==v114||v125.w!==v115){
  v1.vertexAttrib4f(v124,v112,v113,v114,v115);
  v125.x=v112;
  v125.y=v113;
  v125.z=v114;
  v125.w=v115;
  }
  }
  v127=this["sizeBuffer"];
  v53.buffer=v127;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g128,g19);
  v129=false;
  v130=1;
  v131=0;
  v132=0;
  v133=0;
  v134=0;
  v135=null;
  v136=0;
  v137=false;
  v138=5126;
  v139=0;
  v140=0;
  v141=0;
  if(v16(v53)){
  v129=true;
  v135=v8.createStream(34962,v53);
  v138=v135.dtype;
  }
  else{
  v135=v8.getBuffer(v53);
  if(v135){
  v138=v135.dtype;
  }
  else if("constant" in v53){
  v130=2;
  if(typeof v53.constant === "number"){
  v131=v53.constant;
  v132=v133=v134=0;
  }
  else{
  v131=v53.constant.length>0?v53.constant[0]:0;
  v132=v53.constant.length>1?v53.constant[1]:0;
  v133=v53.constant.length>2?v53.constant[2]:0;
  v134=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v135=v8.createStream(34962,v53.buffer);
  }
  else{
  v135=v8.getBuffer(v53.buffer);
  }
  v138="type" in v53?v49[v53.type]:v135.dtype;
  v137=!!v53.normalized;
  v136=v53.size|0;
  v139=v53.offset|0;
  v140=v53.stride|0;
  v141=v53.divisor|0;
  }
  }
  v143=g142.location;
  v144=v10[v143];
  if(v130===1){
  if(!v144.buffer){
  v1.enableVertexAttribArray(v143);
  }
  v145=v136||1;
  if(v144.type!==v138||v144.size!==v145||v144.buffer!==v135||v144.normalized!==v137||v144.offset!==v139||v144.stride!==v140){
  v1.bindBuffer(34962,v135.buffer);
  v1.vertexAttribPointer(v143,v145,v138,v137,v140,v139);
  v144.type=v138;
  v144.size=v145;
  v144.buffer=v135;
  v144.normalized=v137;
  v144.offset=v139;
  v144.stride=v140;
  }
  if(v144.divisor!==v141){
  v107.vertexAttribDivisorANGLE(v143,v141);
  v144.divisor=v141;
  }
  }
  else{
  if(v144.buffer){
  v1.disableVertexAttribArray(v143);
  v144.buffer=null;
  }
  if(v144.x!==v131||v144.y!==v132||v144.z!==v133||v144.w!==v134){
  v1.vertexAttrib4f(v143,v131,v132,v133,v134);
  v144.x=v131;
  v144.y=v132;
  v144.z=v133;
  v144.w=v134;
  }
  }
  v146=this["position"];
  if(!(v146&&(typeof v146==="object"||typeof v146==="function")&&(v16(v146)||v8.getBuffer(v146)||v8.getBuffer(v146.buffer)||v16(v146.buffer)||("constant" in v146&&(typeof v146.constant==="number"||v17(v146.constant))))))g18.commandRaise(g147,g19);
  v148=false;
  v149=1;
  v150=0;
  v151=0;
  v152=0;
  v153=0;
  v154=null;
  v155=0;
  v156=false;
  v157=5126;
  v158=0;
  v159=0;
  v160=0;
  if(v16(v146)){
  v148=true;
  v154=v8.createStream(34962,v146);
  v157=v154.dtype;
  }
  else{
  v154=v8.getBuffer(v146);
  if(v154){
  v157=v154.dtype;
  }
  else if("constant" in v146){
  v149=2;
  if(typeof v146.constant === "number"){
  v150=v146.constant;
  v151=v152=v153=0;
  }
  else{
  v150=v146.constant.length>0?v146.constant[0]:0;
  v151=v146.constant.length>1?v146.constant[1]:0;
  v152=v146.constant.length>2?v146.constant[2]:0;
  v153=v146.constant.length>3?v146.constant[3]:0;
  }
  }
  else{
  if(v16(v146.buffer)){
  v154=v8.createStream(34962,v146.buffer);
  }
  else{
  v154=v8.getBuffer(v146.buffer);
  }
  v157="type" in v146?v49[v146.type]:v154.dtype;
  v156=!!v146.normalized;
  v155=v146.size|0;
  v158=v146.offset|0;
  v159=v146.stride|0;
  v160=v146.divisor|0;
  }
  }
  v162=g161.location;
  v163=v10[v162];
  if(v149===1){
  if(!v163.buffer){
  v1.enableVertexAttribArray(v162);
  }
  v164=v155||2;
  if(v163.type!==v157||v163.size!==v164||v163.buffer!==v154||v163.normalized!==v156||v163.offset!==v158||v163.stride!==v159){
  v1.bindBuffer(34962,v154.buffer);
  v1.vertexAttribPointer(v162,v164,v157,v156,v159,v158);
  v163.type=v157;
  v163.size=v164;
  v163.buffer=v154;
  v163.normalized=v156;
  v163.offset=v158;
  v163.stride=v159;
  }
  if(v163.divisor!==v160){
  v107.vertexAttribDivisorANGLE(v162,v160);
  v163.divisor=v160;
  }
  }
  else{
  if(v163.buffer){
  v1.disableVertexAttribArray(v162);
  v163.buffer=null;
  }
  if(v163.x!==v150||v163.y!==v151||v163.z!==v152||v163.w!==v153){
  v1.vertexAttrib4f(v162,v150,v151,v152,v153);
  v163.x=v150;
  v163.y=v151;
  v163.z=v152;
  v163.w=v153;
  }
  }
  v165=this["sizeBuffer"];
  v54.buffer=v165;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g166,g19);
  v167=false;
  v168=1;
  v169=0;
  v170=0;
  v171=0;
  v172=0;
  v173=null;
  v174=0;
  v175=false;
  v176=5126;
  v177=0;
  v178=0;
  v179=0;
  if(v16(v54)){
  v167=true;
  v173=v8.createStream(34962,v54);
  v176=v173.dtype;
  }
  else{
  v173=v8.getBuffer(v54);
  if(v173){
  v176=v173.dtype;
  }
  else if("constant" in v54){
  v168=2;
  if(typeof v54.constant === "number"){
  v169=v54.constant;
  v170=v171=v172=0;
  }
  else{
  v169=v54.constant.length>0?v54.constant[0]:0;
  v170=v54.constant.length>1?v54.constant[1]:0;
  v171=v54.constant.length>2?v54.constant[2]:0;
  v172=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v173=v8.createStream(34962,v54.buffer);
  }
  else{
  v173=v8.getBuffer(v54.buffer);
  }
  v176="type" in v54?v49[v54.type]:v173.dtype;
  v175=!!v54.normalized;
  v174=v54.size|0;
  v177=v54.offset|0;
  v178=v54.stride|0;
  v179=v54.divisor|0;
  }
  }
  v181=g180.location;
  v182=v10[v181];
  if(v168===1){
  if(!v182.buffer){
  v1.enableVertexAttribArray(v181);
  }
  v183=v174||1;
  if(v182.type!==v176||v182.size!==v183||v182.buffer!==v173||v182.normalized!==v175||v182.offset!==v177||v182.stride!==v178){
  v1.bindBuffer(34962,v173.buffer);
  v1.vertexAttribPointer(v181,v183,v176,v175,v178,v177);
  v182.type=v176;
  v182.size=v183;
  v182.buffer=v173;
  v182.normalized=v175;
  v182.offset=v177;
  v182.stride=v178;
  }
  if(v182.divisor!==v179){
  v107.vertexAttribDivisorANGLE(v181,v179);
  v182.divisor=v179;
  }
  }
  else{
  if(v182.buffer){
  v1.disableVertexAttribArray(v181);
  v182.buffer=null;
  }
  if(v182.x!==v169||v182.y!==v170||v182.z!==v171||v182.w!==v172){
  v1.vertexAttrib4f(v181,v169,v170,v171,v172);
  v182.x=v169;
  v182.y=v170;
  v182.z=v171;
  v182.w=v172;
  }
  }
  v185=a0["align"];
  if(!(typeof v185==="number"))g18.commandRaise(g186,g19);
  v1.uniform1f(g184.location,v185);
  v189=g188.call(this,v2,a0,0);
  if(v189&&v189._reglType==="framebuffer"){
  v189=v189.color[0];
  }
  if(!(typeof v189==="function"&&v189._reglType==="texture2d"))g18.commandRaise(g190,g19);
  v191=v189._texture;
  v1.uniform1i(g187.location,v191.bind());
  v194=g193.call(this,v2,a0,0);
  if(!(v17(v194)&&v194.length===2))g18.commandRaise(g195,g19);
  v196=v194[0];
  v197=v194[1];
  v1.uniform2f(g192.location,v196,v197);
  v200=g199.call(this,v2,a0,0);
  if(!(v17(v200)&&v200.length===2))g18.commandRaise(g201,g19);
  v202=v200[0];
  v203=v200[1];
  v1.uniform2f(g198.location,v202,v203);
  v205=a0["baseline"];
  if(!(typeof v205==="number"))g18.commandRaise(g206,g19);
  v1.uniform1f(g204.location,v205);
  v209=g208.call(this,v2,a0,0);
  if(!(typeof v209==="number"))g18.commandRaise(g210,g19);
  v1.uniform1f(g207.location,v209);
  v212=a0["color"];
  if(!(v17(v212)&&v212.length===4))g18.commandRaise(g213,g19);
  v214=v212[0];
  v215=v212[1];
  v216=v212[2];
  v217=v212[3];
  v1.uniform4f(g211.location,v214,v215,v216,v217);
  v220=g219.call(this,v2,a0,0);
  if(!(typeof v220==="number"))g18.commandRaise(g221,g19);
  v1.uniform1f(g218.location,v220);
  v223=a0["opacity"];
  if(!(typeof v223==="number"))g18.commandRaise(g224,g19);
  v1.uniform1f(g222.location,v223);
  v226=a0["positionOffset"];
  if(!(v17(v226)&&v226.length===2))g18.commandRaise(g227,g19);
  v228=v226[0];
  v229=v226[1];
  v1.uniform2f(g225.location,v228,v229);
  v231=this["scale"];
  if(!(v17(v231)&&v231.length===2))g18.commandRaise(g232,g19);
  v233=v231[0];
  v234=v231[1];
  v1.uniform2f(g230.location,v233,v234);
  v236=this["translate"];
  if(!(v17(v236)&&v236.length===2))g18.commandRaise(g237,g19);
  v238=v236[0];
  v239=v236[1];
  v1.uniform2f(g235.location,v238,v239);
  v241=this["viewportArray"];
  if(!(v17(v241)&&v241.length===4))g18.commandRaise(g242,g19);
  v243=v241[0];
  v244=v241[1];
  v245=v241[2];
  v246=v241[3];
  v1.uniform4f(g240.location,v243,v244,v245,v246);
  v247=v6.elements;
  if(v247){
  v1.bindBuffer(34963,v247.buffer.buffer);
  }
  else if(v11.currentVAO){
  v247=v7.getElements(v11.currentVAO.elements);
  if(v247)v1.bindBuffer(34963,v247.buffer.buffer);
  }
  v248=a0["offset"];
  if(!(v248>=0))g18.commandRaise(g249,g19);
  v250=a0["count"];
  if(!(typeof v250==="number"&&v250>=0&&v250===(v250|0)))g18.commandRaise(g251,g19);
  if(v250){
  v252=v6.instances;
  if(v252>0){
  if(v247){
  v107.drawElementsInstancedANGLE(0,v250,v247.type,v248<<((v247.type-5121)>>1),v252);
  }
  else{
  v107.drawArraysInstancedANGLE(0,v248,v250,v252);
  }
  }
  else if(v252<0){
  if(v247){
  v1.drawElements(0,v250,v247.type,v248<<((v247.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v248,v250);
  }
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v102;
  v2.viewportHeight=v103;
  if(v104){
  g52.cpuTime+=performance.now()-v105;
  }
  if(v110){
  v8.destroyStream(v116);
  }
  if(v129){
  v8.destroyStream(v135);
  }
  if(v148){
  v8.destroyStream(v154);
  }
  if(v167){
  v8.destroyStream(v173);
  }
  v191.unbind();
  }
  }
  ,"scope":function(a0,a1,a2){
  var v253,v254,v255,v256,v257,v258,v259,v260,v261,v262,v263,v264,v265,v266,v267,v268,v269,v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v290,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v301,v302,v303,v304,v305,v306,v307,v308,v309,v310,v311,v312,v313,v314,v315,v316,v317,v318,v319,v320,v321,v323,v324,v325,v326,v327,v328,v329,v330,v331,v332,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v348,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v371,v372,v373,v374,v375,v377,v378,v379,v380,v381,v382,v383,v384,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v397,v398,v399,v400,v401,v402,v404,v405,v406,v407,v408,v409,v410,v411,v412,v413,v414,v415,v416,v417;
  v253=this["viewport"];
  if(!(v253&&typeof v253==="object"))g18.commandRaise(g97,g19);
  v254=v253.x|0;
  v255=v253.y|0;
  v256="width" in v253?v253.width|0:(v2.framebufferWidth-v254);
  v257="height" in v253?v253.height|0:(v2.framebufferHeight-v255);
  if(!(v256>=0&&v257>=0))g18.commandRaise(g97,g19);
  v258=v2.viewportWidth;
  v2.viewportWidth=v256;
  v259=v2.viewportHeight;
  v2.viewportHeight=v257;
  v260=v42[0];
  v42[0]=_gs[6];
  v261=v42[1];
  v42[1]=_gs[7];
  v262=v42[2];
  v42[2]=_gs[8];
  v263=v42[3];
  v42[3]=_gs[9];
  v264=v20[0];
  v20[0]=_gs[10];
  v265=v20[1];
  v20[1]=_gs[11];
  v266=v20[2];
  v20[2]=_gs[12];
  v267=v20[3];
  v20[3]=_gs[13];
  v268=v4.blend_enable;
  v4.blend_enable=_gs[14];
  v269=v24[0];
  v24[0]=_gs[15];
  v270=v24[1];
  v24[1]=_gs[16];
  v271=v24[2];
  v24[2]=_gs[17];
  v272=v24[3];
  v24[3]=_gs[18];
  v273=v4.depth_enable;
  v4.depth_enable=_gs[19];
  v274=v4.stencil_enable;
  v4.stencil_enable=_gs[20];
  v275=v5.profile;
  if(v275){
  v276=performance.now();
  g52.count++;
  }
  v277=a0["offset"];
  if(!(v277>=0))g18.commandRaise(g249,g19);
  v278=v6.offset;
  v6.offset=_gs[21];
  v279=a0["count"];
  if(!(typeof v279==="number"&&v279>=0&&v279===(v279|0)))g18.commandRaise(g251,g19);
  v280=v6.count;
  v6.count=_gs[22];
  v281=v6.primitive;
  v6.primitive=_gs[23];
  v282=g199.call(this,v2,a0,a2);
  v283=v12[_gs[24]];
  v12[_gs[24]]=v282;
  v284=g193.call(this,v2,a0,a2);
  v285=v12[_gs[25]];
  v12[_gs[25]]=v284;
  v286=g188.call(this,v2,a0,a2);
  v287=v12[_gs[26]];
  v12[_gs[26]]=v286;
  v288=g208.call(this,v2,a0,a2);
  v289=v12[_gs[27]];
  v12[_gs[27]]=v288;
  v290=g219.call(this,v2,a0,a2);
  v291=v12[_gs[28]];
  v12[_gs[28]]=v290;
  v292=a0["color"];
  v293=v12[_gs[29]];
  v12[_gs[29]]=v292;
  v294=a0["opacity"];
  v295=v12[_gs[30]];
  v12[_gs[30]]=v294;
  v296=this["viewportArray"];
  v297=v12[_gs[31]];
  v12[_gs[31]]=v296;
  v298=this["scale"];
  v299=v12[_gs[32]];
  v12[_gs[32]]=v298;
  v300=a0["align"];
  v301=v12[_gs[33]];
  v12[_gs[33]]=v300;
  v302=a0["baseline"];
  v303=v12[_gs[34]];
  v12[_gs[34]]=v302;
  v304=this["translate"];
  v305=v12[_gs[35]];
  v12[_gs[35]]=v304;
  v306=a0["positionOffset"];
  v307=v12[_gs[36]];
  v12[_gs[36]]=v306;
  v308=this["charBuffer"];
  if(!(v308&&(typeof v308==="object"||typeof v308==="function")&&(v16(v308)||v8.getBuffer(v308)||v8.getBuffer(v308.buffer)||v16(v308.buffer)||("constant" in v308&&(typeof v308.constant==="number"||v17(v308.constant))))))g18.commandRaise(g109,g19);
  v309=false;
  v310=1;
  v311=0;
  v312=0;
  v313=0;
  v314=0;
  v315=null;
  v316=0;
  v317=false;
  v318=5126;
  v319=0;
  v320=0;
  v321=0;
  if(v16(v308)){
  v309=true;
  v315=v8.createStream(34962,v308);
  v318=v315.dtype;
  }
  else{
  v315=v8.getBuffer(v308);
  if(v315){
  v318=v315.dtype;
  }
  else if("constant" in v308){
  v310=2;
  if(typeof v308.constant === "number"){
  v311=v308.constant;
  v312=v313=v314=0;
  }
  else{
  v311=v308.constant.length>0?v308.constant[0]:0;
  v312=v308.constant.length>1?v308.constant[1]:0;
  v313=v308.constant.length>2?v308.constant[2]:0;
  v314=v308.constant.length>3?v308.constant[3]:0;
  }
  }
  else{
  if(v16(v308.buffer)){
  v315=v8.createStream(34962,v308.buffer);
  }
  else{
  v315=v8.getBuffer(v308.buffer);
  }
  v318="type" in v308?v49[v308.type]:v315.dtype;
  v317=!!v308.normalized;
  v316=v308.size|0;
  v319=v308.offset|0;
  v320=v308.stride|0;
  v321=v308.divisor|0;
  }
  }
  v323=g322.state;
  g322.state=v310;
  v324=g322.x;
  g322.x=v311;
  v325=g322.y;
  g322.y=v312;
  v326=g322.z;
  g322.z=v313;
  v327=g322.w;
  g322.w=v314;
  v328=g322.buffer;
  g322.buffer=v315;
  v329=g322.size;
  g322.size=v316;
  v330=g322.normalized;
  g322.normalized=v317;
  v331=g322.type;
  g322.type=v318;
  v332=g322.offset;
  g322.offset=v319;
  v333=g322.stride;
  g322.stride=v320;
  v334=g322.divisor;
  g322.divisor=v321;
  v335=this["position"];
  if(!(v335&&(typeof v335==="object"||typeof v335==="function")&&(v16(v335)||v8.getBuffer(v335)||v8.getBuffer(v335.buffer)||v16(v335.buffer)||("constant" in v335&&(typeof v335.constant==="number"||v17(v335.constant))))))g18.commandRaise(g147,g19);
  v336=false;
  v337=1;
  v338=0;
  v339=0;
  v340=0;
  v341=0;
  v342=null;
  v343=0;
  v344=false;
  v345=5126;
  v346=0;
  v347=0;
  v348=0;
  if(v16(v335)){
  v336=true;
  v342=v8.createStream(34962,v335);
  v345=v342.dtype;
  }
  else{
  v342=v8.getBuffer(v335);
  if(v342){
  v345=v342.dtype;
  }
  else if("constant" in v335){
  v337=2;
  if(typeof v335.constant === "number"){
  v338=v335.constant;
  v339=v340=v341=0;
  }
  else{
  v338=v335.constant.length>0?v335.constant[0]:0;
  v339=v335.constant.length>1?v335.constant[1]:0;
  v340=v335.constant.length>2?v335.constant[2]:0;
  v341=v335.constant.length>3?v335.constant[3]:0;
  }
  }
  else{
  if(v16(v335.buffer)){
  v342=v8.createStream(34962,v335.buffer);
  }
  else{
  v342=v8.getBuffer(v335.buffer);
  }
  v345="type" in v335?v49[v335.type]:v342.dtype;
  v344=!!v335.normalized;
  v343=v335.size|0;
  v346=v335.offset|0;
  v347=v335.stride|0;
  v348=v335.divisor|0;
  }
  }
  v350=g349.state;
  g349.state=v337;
  v351=g349.x;
  g349.x=v338;
  v352=g349.y;
  g349.y=v339;
  v353=g349.z;
  g349.z=v340;
  v354=g349.w;
  g349.w=v341;
  v355=g349.buffer;
  g349.buffer=v342;
  v356=g349.size;
  g349.size=v343;
  v357=g349.normalized;
  g349.normalized=v344;
  v358=g349.type;
  g349.type=v345;
  v359=g349.offset;
  g349.offset=v346;
  v360=g349.stride;
  g349.stride=v347;
  v361=g349.divisor;
  g349.divisor=v348;
  v362=this["sizeBuffer"];
  v53.buffer=v362;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g128,g19);
  v363=false;
  v364=1;
  v365=0;
  v366=0;
  v367=0;
  v368=0;
  v369=null;
  v370=0;
  v371=false;
  v372=5126;
  v373=0;
  v374=0;
  v375=0;
  if(v16(v53)){
  v363=true;
  v369=v8.createStream(34962,v53);
  v372=v369.dtype;
  }
  else{
  v369=v8.getBuffer(v53);
  if(v369){
  v372=v369.dtype;
  }
  else if("constant" in v53){
  v364=2;
  if(typeof v53.constant === "number"){
  v365=v53.constant;
  v366=v367=v368=0;
  }
  else{
  v365=v53.constant.length>0?v53.constant[0]:0;
  v366=v53.constant.length>1?v53.constant[1]:0;
  v367=v53.constant.length>2?v53.constant[2]:0;
  v368=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v369=v8.createStream(34962,v53.buffer);
  }
  else{
  v369=v8.getBuffer(v53.buffer);
  }
  v372="type" in v53?v49[v53.type]:v369.dtype;
  v371=!!v53.normalized;
  v370=v53.size|0;
  v373=v53.offset|0;
  v374=v53.stride|0;
  v375=v53.divisor|0;
  }
  }
  v377=g376.state;
  g376.state=v364;
  v378=g376.x;
  g376.x=v365;
  v379=g376.y;
  g376.y=v366;
  v380=g376.z;
  g376.z=v367;
  v381=g376.w;
  g376.w=v368;
  v382=g376.buffer;
  g376.buffer=v369;
  v383=g376.size;
  g376.size=v370;
  v384=g376.normalized;
  g376.normalized=v371;
  v385=g376.type;
  g376.type=v372;
  v386=g376.offset;
  g376.offset=v373;
  v387=g376.stride;
  g376.stride=v374;
  v388=g376.divisor;
  g376.divisor=v375;
  v389=this["sizeBuffer"];
  v54.buffer=v389;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g166,g19);
  v390=false;
  v391=1;
  v392=0;
  v393=0;
  v394=0;
  v395=0;
  v396=null;
  v397=0;
  v398=false;
  v399=5126;
  v400=0;
  v401=0;
  v402=0;
  if(v16(v54)){
  v390=true;
  v396=v8.createStream(34962,v54);
  v399=v396.dtype;
  }
  else{
  v396=v8.getBuffer(v54);
  if(v396){
  v399=v396.dtype;
  }
  else if("constant" in v54){
  v391=2;
  if(typeof v54.constant === "number"){
  v392=v54.constant;
  v393=v394=v395=0;
  }
  else{
  v392=v54.constant.length>0?v54.constant[0]:0;
  v393=v54.constant.length>1?v54.constant[1]:0;
  v394=v54.constant.length>2?v54.constant[2]:0;
  v395=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v396=v8.createStream(34962,v54.buffer);
  }
  else{
  v396=v8.getBuffer(v54.buffer);
  }
  v399="type" in v54?v49[v54.type]:v396.dtype;
  v398=!!v54.normalized;
  v397=v54.size|0;
  v400=v54.offset|0;
  v401=v54.stride|0;
  v402=v54.divisor|0;
  }
  }
  v404=g403.state;
  g403.state=v391;
  v405=g403.x;
  g403.x=v392;
  v406=g403.y;
  g403.y=v393;
  v407=g403.z;
  g403.z=v394;
  v408=g403.w;
  g403.w=v395;
  v409=g403.buffer;
  g403.buffer=v396;
  v410=g403.size;
  g403.size=v397;
  v411=g403.normalized;
  g403.normalized=v398;
  v412=g403.type;
  g403.type=v399;
  v413=g403.offset;
  g403.offset=v400;
  v414=g403.stride;
  g403.stride=v401;
  v415=g403.divisor;
  g403.divisor=v402;
  v416=v9.vert;
  v9.vert=_gs[37];
  v417=v9.frag;
  v9.frag=_gs[38];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v258;
  v2.viewportHeight=v259;
  v42[0]=v260;
  v42[1]=v261;
  v42[2]=v262;
  v42[3]=v263;
  v20[0]=v264;
  v20[1]=v265;
  v20[2]=v266;
  v20[3]=v267;
  v4.blend_enable=v268;
  v24[0]=v269;
  v24[1]=v270;
  v24[2]=v271;
  v24[3]=v272;
  v4.depth_enable=v273;
  v4.stencil_enable=v274;
  if(v275){
  g52.cpuTime+=performance.now()-v276;
  }
  v6.offset=v278;
  v6.count=v280;
  v6.primitive=v281;
  v12[_gs[24]]=v283;
  v12[_gs[25]]=v285;
  v12[_gs[26]]=v287;
  v12[_gs[27]]=v289;
  v12[_gs[28]]=v291;
  v12[_gs[29]]=v293;
  v12[_gs[30]]=v295;
  v12[_gs[31]]=v297;
  v12[_gs[32]]=v299;
  v12[_gs[33]]=v301;
  v12[_gs[34]]=v303;
  v12[_gs[35]]=v305;
  v12[_gs[36]]=v307;
  if(v309){
  v8.destroyStream(v315);
  }
  g322.state=v323;
  g322.x=v324;
  g322.y=v325;
  g322.z=v326;
  g322.w=v327;
  g322.buffer=v328;
  g322.size=v329;
  g322.normalized=v330;
  g322.type=v331;
  g322.offset=v332;
  g322.stride=v333;
  g322.divisor=v334;
  if(v336){
  v8.destroyStream(v342);
  }
  g349.state=v350;
  g349.x=v351;
  g349.y=v352;
  g349.z=v353;
  g349.w=v354;
  g349.buffer=v355;
  g349.size=v356;
  g349.normalized=v357;
  g349.type=v358;
  g349.offset=v359;
  g349.stride=v360;
  g349.divisor=v361;
  if(v363){
  v8.destroyStream(v369);
  }
  g376.state=v377;
  g376.x=v378;
  g376.y=v379;
  g376.z=v380;
  g376.w=v381;
  g376.buffer=v382;
  g376.size=v383;
  g376.normalized=v384;
  g376.type=v385;
  g376.offset=v386;
  g376.stride=v387;
  g376.divisor=v388;
  if(v390){
  v8.destroyStream(v396);
  }
  g403.state=v404;
  g403.x=v405;
  g403.y=v406;
  g403.z=v407;
  g403.w=v408;
  g403.buffer=v409;
  g403.size=v410;
  g403.normalized=v411;
  g403.type=v412;
  g403.offset=v413;
  g403.stride=v414;
  g403.divisor=v415;
  v9.vert=v416;
  v9.frag=v417;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v418,v419,v459,v460,v461,v462,v463,v464,v465,v466,v467,v468,v469,v470;
  v418=v14.angle_instanced_arrays;
  v419=v13.next;
  if(v419!==v13.cur){
  if(v419){
  v1.bindFramebuffer(36160,v419.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v419;
  }
  if(v5.dirty){
  var v420,v421,v422,v423,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v434,v435,v436,v437,v438,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v449,v450,v451,v452,v453,v454,v455,v456,v457,v458;
  v420=v4.dither;
  if(v420!==v5.dither){
  if(v420){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v420;
  }
  v421=v22[0];
  v422=v22[1];
  if(v421!==v23[0]||v422!==v23[1]){
  v1.blendEquationSeparate(v421,v422);
  v23[0]=v421;
  v23[1]=v422;
  }
  v423=v4.depth_func;
  if(v423!==v5.depth_func){
  v1.depthFunc(v423);
  v5.depth_func=v423;
  }
  v424=v26[0];
  v425=v26[1];
  if(v424!==v27[0]||v425!==v27[1]){
  v1.depthRange(v424,v425);
  v27[0]=v424;
  v27[1]=v425;
  }
  v426=v4.depth_mask;
  if(v426!==v5.depth_mask){
  v1.depthMask(v426);
  v5.depth_mask=v426;
  }
  v427=v28[0];
  v428=v28[1];
  v429=v28[2];
  v430=v28[3];
  if(v427!==v29[0]||v428!==v29[1]||v429!==v29[2]||v430!==v29[3]){
  v1.colorMask(v427,v428,v429,v430);
  v29[0]=v427;
  v29[1]=v428;
  v29[2]=v429;
  v29[3]=v430;
  }
  v431=v4.cull_enable;
  if(v431!==v5.cull_enable){
  if(v431){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v431;
  }
  v432=v4.cull_face;
  if(v432!==v5.cull_face){
  v1.cullFace(v432);
  v5.cull_face=v432;
  }
  v433=v4.frontFace;
  if(v433!==v5.frontFace){
  v1.frontFace(v433);
  v5.frontFace=v433;
  }
  v434=v4.lineWidth;
  if(v434!==v5.lineWidth){
  v1.lineWidth(v434);
  v5.lineWidth=v434;
  }
  v435=v4.polygonOffset_enable;
  if(v435!==v5.polygonOffset_enable){
  if(v435){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v435;
  }
  v436=v30[0];
  v437=v30[1];
  if(v436!==v31[0]||v437!==v31[1]){
  v1.polygonOffset(v436,v437);
  v31[0]=v436;
  v31[1]=v437;
  }
  v438=v4.sample_alpha;
  if(v438!==v5.sample_alpha){
  if(v438){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v438;
  }
  v439=v4.sample_enable;
  if(v439!==v5.sample_enable){
  if(v439){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v439;
  }
  v440=v32[0];
  v441=v32[1];
  if(v440!==v33[0]||v441!==v33[1]){
  v1.sampleCoverage(v440,v441);
  v33[0]=v440;
  v33[1]=v441;
  }
  v442=v4.stencil_mask;
  if(v442!==v5.stencil_mask){
  v1.stencilMask(v442);
  v5.stencil_mask=v442;
  }
  v443=v34[0];
  v444=v34[1];
  v445=v34[2];
  if(v443!==v35[0]||v444!==v35[1]||v445!==v35[2]){
  v1.stencilFunc(v443,v444,v445);
  v35[0]=v443;
  v35[1]=v444;
  v35[2]=v445;
  }
  v446=v36[0];
  v447=v36[1];
  v448=v36[2];
  v449=v36[3];
  if(v446!==v37[0]||v447!==v37[1]||v448!==v37[2]||v449!==v37[3]){
  v1.stencilOpSeparate(v446,v447,v448,v449);
  v37[0]=v446;
  v37[1]=v447;
  v37[2]=v448;
  v37[3]=v449;
  }
  v450=v38[0];
  v451=v38[1];
  v452=v38[2];
  v453=v38[3];
  if(v450!==v39[0]||v451!==v39[1]||v452!==v39[2]||v453!==v39[3]){
  v1.stencilOpSeparate(v450,v451,v452,v453);
  v39[0]=v450;
  v39[1]=v451;
  v39[2]=v452;
  v39[3]=v453;
  }
  v454=v4.scissor_enable;
  if(v454!==v5.scissor_enable){
  if(v454){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v454;
  }
  v455=v40[0];
  v456=v40[1];
  v457=v40[2];
  v458=v40[3];
  if(v455!==v41[0]||v456!==v41[1]||v457!==v41[2]||v458!==v41[3]){
  v1.scissor(v455,v456,v457,v458);
  v41[0]=v455;
  v41[1]=v456;
  v41[2]=v457;
  v41[3]=v458;
  }
  }
  v459=this["viewport"];
  if(!(v459&&typeof v459==="object"))g18.commandRaise(g97,g19);
  v460=v459.x|0;
  v461=v459.y|0;
  v462="width" in v459?v459.width|0:(v2.framebufferWidth-v460);
  v463="height" in v459?v459.height|0:(v2.framebufferHeight-v461);
  if(!(v462>=0&&v463>=0))g18.commandRaise(g97,g19);
  v464=v2.viewportWidth;
  v2.viewportWidth=v462;
  v465=v2.viewportHeight;
  v2.viewportHeight=v463;
  v1.viewport(v460,v461,v462,v463);
  v43[0]=v460;
  v43[1]=v461;
  v43[2]=v462;
  v43[3]=v463;
  v1.blendColor(0,0,0,1);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=1;
  if(_gs[39]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[40];
  v1.blendFuncSeparate(770,771,773,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=773;
  v25[3]=1;
  if(_gs[41]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[42];
  if(_gs[43]){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=_gs[44];
  v466=v5.profile;
  if(v466){
  v467=performance.now();
  g52.count+=a1;
  }
  v1.useProgram(g106.program);
  v468=v14.angle_instanced_arrays;
  var v471,v472,v473,v474,v475,v476,v477,v478,v479,v480,v481,v482,v483,v484,v485,v486,v487,v488,v489,v490,v491,v492,v493,v494,v495,v496,v497,v498,v499,v500,v501,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v514,v515,v516,v517,v518,v519,v520,v521,v522,v523,v524,v525,v526,v527,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537,v538,v539,v540,v541,v542,v543,v544,v545,v546,v547,v548,v549,v586,v589;
  v11.setVAO(null);
  v471=this["charBuffer"];
  if(!(v471&&(typeof v471==="object"||typeof v471==="function")&&(v16(v471)||v8.getBuffer(v471)||v8.getBuffer(v471.buffer)||v16(v471.buffer)||("constant" in v471&&(typeof v471.constant==="number"||v17(v471.constant))))))g18.commandRaise(g109,g19);
  v472=false;
  v473=1;
  v474=0;
  v475=0;
  v476=0;
  v477=0;
  v478=null;
  v479=0;
  v480=false;
  v481=5126;
  v482=0;
  v483=0;
  v484=0;
  if(v16(v471)){
  v472=true;
  v478=v8.createStream(34962,v471);
  v481=v478.dtype;
  }
  else{
  v478=v8.getBuffer(v471);
  if(v478){
  v481=v478.dtype;
  }
  else if("constant" in v471){
  v473=2;
  if(typeof v471.constant === "number"){
  v474=v471.constant;
  v475=v476=v477=0;
  }
  else{
  v474=v471.constant.length>0?v471.constant[0]:0;
  v475=v471.constant.length>1?v471.constant[1]:0;
  v476=v471.constant.length>2?v471.constant[2]:0;
  v477=v471.constant.length>3?v471.constant[3]:0;
  }
  }
  else{
  if(v16(v471.buffer)){
  v478=v8.createStream(34962,v471.buffer);
  }
  else{
  v478=v8.getBuffer(v471.buffer);
  }
  v481="type" in v471?v49[v471.type]:v478.dtype;
  v480=!!v471.normalized;
  v479=v471.size|0;
  v482=v471.offset|0;
  v483=v471.stride|0;
  v484=v471.divisor|0;
  }
  }
  v485=g123.location;
  v486=v10[v485];
  if(v473===1){
  if(!v486.buffer){
  v1.enableVertexAttribArray(v485);
  }
  v487=v479||1;
  if(v486.type!==v481||v486.size!==v487||v486.buffer!==v478||v486.normalized!==v480||v486.offset!==v482||v486.stride!==v483){
  v1.bindBuffer(34962,v478.buffer);
  v1.vertexAttribPointer(v485,v487,v481,v480,v483,v482);
  v486.type=v481;
  v486.size=v487;
  v486.buffer=v478;
  v486.normalized=v480;
  v486.offset=v482;
  v486.stride=v483;
  }
  if(v486.divisor!==v484){
  v468.vertexAttribDivisorANGLE(v485,v484);
  v486.divisor=v484;
  }
  }
  else{
  if(v486.buffer){
  v1.disableVertexAttribArray(v485);
  v486.buffer=null;
  }
  if(v486.x!==v474||v486.y!==v475||v486.z!==v476||v486.w!==v477){
  v1.vertexAttrib4f(v485,v474,v475,v476,v477);
  v486.x=v474;
  v486.y=v475;
  v486.z=v476;
  v486.w=v477;
  }
  }
  v488=this["sizeBuffer"];
  v53.buffer=v488;
  if(!(v53&&(typeof v53==="object"||typeof v53==="function")&&(v16(v53)||v8.getBuffer(v53)||v8.getBuffer(v53.buffer)||v16(v53.buffer)||("constant" in v53&&(typeof v53.constant==="number"||v17(v53.constant))))))g18.commandRaise(g128,g19);
  v489=false;
  v490=1;
  v491=0;
  v492=0;
  v493=0;
  v494=0;
  v495=null;
  v496=0;
  v497=false;
  v498=5126;
  v499=0;
  v500=0;
  v501=0;
  if(v16(v53)){
  v489=true;
  v495=v8.createStream(34962,v53);
  v498=v495.dtype;
  }
  else{
  v495=v8.getBuffer(v53);
  if(v495){
  v498=v495.dtype;
  }
  else if("constant" in v53){
  v490=2;
  if(typeof v53.constant === "number"){
  v491=v53.constant;
  v492=v493=v494=0;
  }
  else{
  v491=v53.constant.length>0?v53.constant[0]:0;
  v492=v53.constant.length>1?v53.constant[1]:0;
  v493=v53.constant.length>2?v53.constant[2]:0;
  v494=v53.constant.length>3?v53.constant[3]:0;
  }
  }
  else{
  if(v16(v53.buffer)){
  v495=v8.createStream(34962,v53.buffer);
  }
  else{
  v495=v8.getBuffer(v53.buffer);
  }
  v498="type" in v53?v49[v53.type]:v495.dtype;
  v497=!!v53.normalized;
  v496=v53.size|0;
  v499=v53.offset|0;
  v500=v53.stride|0;
  v501=v53.divisor|0;
  }
  }
  v502=g142.location;
  v503=v10[v502];
  if(v490===1){
  if(!v503.buffer){
  v1.enableVertexAttribArray(v502);
  }
  v504=v496||1;
  if(v503.type!==v498||v503.size!==v504||v503.buffer!==v495||v503.normalized!==v497||v503.offset!==v499||v503.stride!==v500){
  v1.bindBuffer(34962,v495.buffer);
  v1.vertexAttribPointer(v502,v504,v498,v497,v500,v499);
  v503.type=v498;
  v503.size=v504;
  v503.buffer=v495;
  v503.normalized=v497;
  v503.offset=v499;
  v503.stride=v500;
  }
  if(v503.divisor!==v501){
  v468.vertexAttribDivisorANGLE(v502,v501);
  v503.divisor=v501;
  }
  }
  else{
  if(v503.buffer){
  v1.disableVertexAttribArray(v502);
  v503.buffer=null;
  }
  if(v503.x!==v491||v503.y!==v492||v503.z!==v493||v503.w!==v494){
  v1.vertexAttrib4f(v502,v491,v492,v493,v494);
  v503.x=v491;
  v503.y=v492;
  v503.z=v493;
  v503.w=v494;
  }
  }
  v505=this["position"];
  if(!(v505&&(typeof v505==="object"||typeof v505==="function")&&(v16(v505)||v8.getBuffer(v505)||v8.getBuffer(v505.buffer)||v16(v505.buffer)||("constant" in v505&&(typeof v505.constant==="number"||v17(v505.constant))))))g18.commandRaise(g147,g19);
  v506=false;
  v507=1;
  v508=0;
  v509=0;
  v510=0;
  v511=0;
  v512=null;
  v513=0;
  v514=false;
  v515=5126;
  v516=0;
  v517=0;
  v518=0;
  if(v16(v505)){
  v506=true;
  v512=v8.createStream(34962,v505);
  v515=v512.dtype;
  }
  else{
  v512=v8.getBuffer(v505);
  if(v512){
  v515=v512.dtype;
  }
  else if("constant" in v505){
  v507=2;
  if(typeof v505.constant === "number"){
  v508=v505.constant;
  v509=v510=v511=0;
  }
  else{
  v508=v505.constant.length>0?v505.constant[0]:0;
  v509=v505.constant.length>1?v505.constant[1]:0;
  v510=v505.constant.length>2?v505.constant[2]:0;
  v511=v505.constant.length>3?v505.constant[3]:0;
  }
  }
  else{
  if(v16(v505.buffer)){
  v512=v8.createStream(34962,v505.buffer);
  }
  else{
  v512=v8.getBuffer(v505.buffer);
  }
  v515="type" in v505?v49[v505.type]:v512.dtype;
  v514=!!v505.normalized;
  v513=v505.size|0;
  v516=v505.offset|0;
  v517=v505.stride|0;
  v518=v505.divisor|0;
  }
  }
  v519=g161.location;
  v520=v10[v519];
  if(v507===1){
  if(!v520.buffer){
  v1.enableVertexAttribArray(v519);
  }
  v521=v513||2;
  if(v520.type!==v515||v520.size!==v521||v520.buffer!==v512||v520.normalized!==v514||v520.offset!==v516||v520.stride!==v517){
  v1.bindBuffer(34962,v512.buffer);
  v1.vertexAttribPointer(v519,v521,v515,v514,v517,v516);
  v520.type=v515;
  v520.size=v521;
  v520.buffer=v512;
  v520.normalized=v514;
  v520.offset=v516;
  v520.stride=v517;
  }
  if(v520.divisor!==v518){
  v468.vertexAttribDivisorANGLE(v519,v518);
  v520.divisor=v518;
  }
  }
  else{
  if(v520.buffer){
  v1.disableVertexAttribArray(v519);
  v520.buffer=null;
  }
  if(v520.x!==v508||v520.y!==v509||v520.z!==v510||v520.w!==v511){
  v1.vertexAttrib4f(v519,v508,v509,v510,v511);
  v520.x=v508;
  v520.y=v509;
  v520.z=v510;
  v520.w=v511;
  }
  }
  v522=this["sizeBuffer"];
  v54.buffer=v522;
  if(!(v54&&(typeof v54==="object"||typeof v54==="function")&&(v16(v54)||v8.getBuffer(v54)||v8.getBuffer(v54.buffer)||v16(v54.buffer)||("constant" in v54&&(typeof v54.constant==="number"||v17(v54.constant))))))g18.commandRaise(g166,g19);
  v523=false;
  v524=1;
  v525=0;
  v526=0;
  v527=0;
  v528=0;
  v529=null;
  v530=0;
  v531=false;
  v532=5126;
  v533=0;
  v534=0;
  v535=0;
  if(v16(v54)){
  v523=true;
  v529=v8.createStream(34962,v54);
  v532=v529.dtype;
  }
  else{
  v529=v8.getBuffer(v54);
  if(v529){
  v532=v529.dtype;
  }
  else if("constant" in v54){
  v524=2;
  if(typeof v54.constant === "number"){
  v525=v54.constant;
  v526=v527=v528=0;
  }
  else{
  v525=v54.constant.length>0?v54.constant[0]:0;
  v526=v54.constant.length>1?v54.constant[1]:0;
  v527=v54.constant.length>2?v54.constant[2]:0;
  v528=v54.constant.length>3?v54.constant[3]:0;
  }
  }
  else{
  if(v16(v54.buffer)){
  v529=v8.createStream(34962,v54.buffer);
  }
  else{
  v529=v8.getBuffer(v54.buffer);
  }
  v532="type" in v54?v49[v54.type]:v529.dtype;
  v531=!!v54.normalized;
  v530=v54.size|0;
  v533=v54.offset|0;
  v534=v54.stride|0;
  v535=v54.divisor|0;
  }
  }
  v536=g180.location;
  v537=v10[v536];
  if(v524===1){
  if(!v537.buffer){
  v1.enableVertexAttribArray(v536);
  }
  v538=v530||1;
  if(v537.type!==v532||v537.size!==v538||v537.buffer!==v529||v537.normalized!==v531||v537.offset!==v533||v537.stride!==v534){
  v1.bindBuffer(34962,v529.buffer);
  v1.vertexAttribPointer(v536,v538,v532,v531,v534,v533);
  v537.type=v532;
  v537.size=v538;
  v537.buffer=v529;
  v537.normalized=v531;
  v537.offset=v533;
  v537.stride=v534;
  }
  if(v537.divisor!==v535){
  v468.vertexAttribDivisorANGLE(v536,v535);
  v537.divisor=v535;
  }
  }
  else{
  if(v537.buffer){
  v1.disableVertexAttribArray(v536);
  v537.buffer=null;
  }
  if(v537.x!==v525||v537.y!==v526||v537.z!==v527||v537.w!==v528){
  v1.vertexAttrib4f(v536,v525,v526,v527,v528);
  v537.x=v525;
  v537.y=v526;
  v537.z=v527;
  v537.w=v528;
  }
  }
  v539=this["scale"];
  if(!(v17(v539)&&v539.length===2))g18.commandRaise(g232,g19);
  v540=v539[0];
  v541=v539[1];
  v1.uniform2f(g230.location,v540,v541);
  v542=this["translate"];
  if(!(v17(v542)&&v542.length===2))g18.commandRaise(g237,g19);
  v543=v542[0];
  v544=v542[1];
  v1.uniform2f(g235.location,v543,v544);
  v545=this["viewportArray"];
  if(!(v17(v545)&&v545.length===4))g18.commandRaise(g242,g19);
  v546=v545[0];
  v547=v545[1];
  v548=v545[2];
  v549=v545[3];
  v1.uniform4f(g240.location,v546,v547,v548,v549);
  v586=v6.elements;
  if(v586){
  v1.bindBuffer(34963,v586.buffer.buffer);
  }
  else if(v11.currentVAO){
  v586=v7.getElements(v11.currentVAO.elements);
  if(v586)v1.bindBuffer(34963,v586.buffer.buffer);
  }
  v589=v6.instances;
  for(v469=0;
  v469<a1;
  ++v469){
  v470=a0[v469];
  var v550,v551,v552,v553,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v566,v567,v568,v569,v570,v571,v572,v573,v574,v575,v576,v577,v578,v579,v580,v581,v582,v583,v584,v585,v587,v588;
  v550=v470["align"];
  if(!(typeof v550==="number"))g18.commandRaise(g186,g19);
  if(!v469||v551!==v550){
  v551=v550;
  v1.uniform1f(g184.location,v550);
  }
  v552=g188.call(this,v2,v470,v469);
  if(v552&&v552._reglType==="framebuffer"){
  v552=v552.color[0];
  }
  if(!(typeof v552==="function"&&v552._reglType==="texture2d"))g18.commandRaise(g190,g19);
  v553=v552._texture;
  v1.uniform1i(g187.location,v553.bind());
  v554=g193.call(this,v2,v470,v469);
  if(!(v17(v554)&&v554.length===2))g18.commandRaise(g195,g19);
  v555=v554[0];
  v557=v554[1];
  if(!v469||v556!==v555||v558!==v557){
  v556=v555;
  v558=v557;
  v1.uniform2f(g192.location,v555,v557);
  }
  v559=g199.call(this,v2,v470,v469);
  if(!(v17(v559)&&v559.length===2))g18.commandRaise(g201,g19);
  v560=v559[0];
  v562=v559[1];
  if(!v469||v561!==v560||v563!==v562){
  v561=v560;
  v563=v562;
  v1.uniform2f(g198.location,v560,v562);
  }
  v564=v470["baseline"];
  if(!(typeof v564==="number"))g18.commandRaise(g206,g19);
  if(!v469||v565!==v564){
  v565=v564;
  v1.uniform1f(g204.location,v564);
  }
  v566=g208.call(this,v2,v470,v469);
  if(!(typeof v566==="number"))g18.commandRaise(g210,g19);
  if(!v469||v567!==v566){
  v567=v566;
  v1.uniform1f(g207.location,v566);
  }
  v568=v470["color"];
  if(!(v17(v568)&&v568.length===4))g18.commandRaise(g213,g19);
  v569=v568[0];
  v571=v568[1];
  v573=v568[2];
  v575=v568[3];
  if(!v469||v570!==v569||v572!==v571||v574!==v573||v576!==v575){
  v570=v569;
  v572=v571;
  v574=v573;
  v576=v575;
  v1.uniform4f(g211.location,v569,v571,v573,v575);
  }
  v577=g219.call(this,v2,v470,v469);
  if(!(typeof v577==="number"))g18.commandRaise(g221,g19);
  if(!v469||v578!==v577){
  v578=v577;
  v1.uniform1f(g218.location,v577);
  }
  v579=v470["opacity"];
  if(!(typeof v579==="number"))g18.commandRaise(g224,g19);
  if(!v469||v580!==v579){
  v580=v579;
  v1.uniform1f(g222.location,v579);
  }
  v581=v470["positionOffset"];
  if(!(v17(v581)&&v581.length===2))g18.commandRaise(g227,g19);
  v582=v581[0];
  v584=v581[1];
  if(!v469||v583!==v582||v585!==v584){
  v583=v582;
  v585=v584;
  v1.uniform2f(g225.location,v582,v584);
  }
  v587=v470["offset"];
  if(!(v587>=0))g18.commandRaise(g249,g19);
  v588=v470["count"];
  if(!(typeof v588==="number"&&v588>=0&&v588===(v588|0)))g18.commandRaise(g251,g19);
  if(v588){
  if(v589>0){
  if(v586){
  v468.drawElementsInstancedANGLE(0,v588,v586.type,v587<<((v586.type-5121)>>1),v589);
  }
  else{
  v468.drawArraysInstancedANGLE(0,v587,v588,v589);
  }
  }
  else if(v589<0){
  if(v586){
  v1.drawElements(0,v588,v586.type,v587<<((v586.type-5121)>>1));
  }
  else{
  v1.drawArrays(0,v587,v588);
  }
  }
  v553.unbind();
  }
  }
  if(v472){
  v8.destroyStream(v478);
  }
  if(v489){
  v8.destroyStream(v495);
  }
  if(v506){
  v8.destroyStream(v512);
  }
  if(v523){
  v8.destroyStream(v529);
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v464;
  v2.viewportHeight=v465;
  if(v466){
  g52.cpuTime+=performance.now()-v467;
  }
  }
  ,}
  
  },
  "12563.28": function (_gs, g0, g18, g19, g52, g55, g119, g195) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v116,v192;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v116={
  }
  ;
  v192={
  }
  ;
  return {
  "draw":function(a0){
  var v53,v54,v56,v57,v58,v105,v106,v107,v108,v109,v110,v111,v112,v113,v114,v115,v117,v118;
  v53=a0["framebuffer"];
  v54=v13.getFramebuffer(v53);
  if(!(!v53||v54))g18.commandRaise(g55,g19);
  v56=v13.next;
  v13.next=v54;
  v57=v2.framebufferWidth;
  v2.framebufferWidth=v54?v54.width:v2.drawingBufferWidth;
  v58=v2.framebufferHeight;
  v2.framebufferHeight=v54?v54.height:v2.drawingBufferHeight;
  if(v54!==v13.cur){
  if(v54){
  v1.bindFramebuffer(36160,v54.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v54;
  }
  if(v5.dirty){
  var v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95,v96,v97,v98,v99,v100,v101,v102,v103,v104;
  v59=v4.dither;
  if(v59!==v5.dither){
  if(v59){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v59;
  }
  v60=v4.blend_enable;
  if(v60!==v5.blend_enable){
  if(v60){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v60;
  }
  v61=v20[0];
  v62=v20[1];
  v63=v20[2];
  v64=v20[3];
  if(v61!==v21[0]||v62!==v21[1]||v63!==v21[2]||v64!==v21[3]){
  v1.blendColor(v61,v62,v63,v64);
  v21[0]=v61;
  v21[1]=v62;
  v21[2]=v63;
  v21[3]=v64;
  }
  v65=v22[0];
  v66=v22[1];
  if(v65!==v23[0]||v66!==v23[1]){
  v1.blendEquationSeparate(v65,v66);
  v23[0]=v65;
  v23[1]=v66;
  }
  v67=v24[0];
  v68=v24[1];
  v69=v24[2];
  v70=v24[3];
  if(v67!==v25[0]||v68!==v25[1]||v69!==v25[2]||v70!==v25[3]){
  v1.blendFuncSeparate(v67,v68,v69,v70);
  v25[0]=v67;
  v25[1]=v68;
  v25[2]=v69;
  v25[3]=v70;
  }
  v71=v4.depth_enable;
  if(v71!==v5.depth_enable){
  if(v71){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v71;
  }
  v72=v4.depth_func;
  if(v72!==v5.depth_func){
  v1.depthFunc(v72);
  v5.depth_func=v72;
  }
  v73=v26[0];
  v74=v26[1];
  if(v73!==v27[0]||v74!==v27[1]){
  v1.depthRange(v73,v74);
  v27[0]=v73;
  v27[1]=v74;
  }
  v75=v4.depth_mask;
  if(v75!==v5.depth_mask){
  v1.depthMask(v75);
  v5.depth_mask=v75;
  }
  v76=v28[0];
  v77=v28[1];
  v78=v28[2];
  v79=v28[3];
  if(v76!==v29[0]||v77!==v29[1]||v78!==v29[2]||v79!==v29[3]){
  v1.colorMask(v76,v77,v78,v79);
  v29[0]=v76;
  v29[1]=v77;
  v29[2]=v78;
  v29[3]=v79;
  }
  v80=v4.cull_enable;
  if(v80!==v5.cull_enable){
  if(v80){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v80;
  }
  v81=v4.cull_face;
  if(v81!==v5.cull_face){
  v1.cullFace(v81);
  v5.cull_face=v81;
  }
  v82=v4.frontFace;
  if(v82!==v5.frontFace){
  v1.frontFace(v82);
  v5.frontFace=v82;
  }
  v83=v4.lineWidth;
  if(v83!==v5.lineWidth){
  v1.lineWidth(v83);
  v5.lineWidth=v83;
  }
  v84=v4.polygonOffset_enable;
  if(v84!==v5.polygonOffset_enable){
  if(v84){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v84;
  }
  v85=v30[0];
  v86=v30[1];
  if(v85!==v31[0]||v86!==v31[1]){
  v1.polygonOffset(v85,v86);
  v31[0]=v85;
  v31[1]=v86;
  }
  v87=v4.sample_alpha;
  if(v87!==v5.sample_alpha){
  if(v87){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v87;
  }
  v88=v4.sample_enable;
  if(v88!==v5.sample_enable){
  if(v88){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v88;
  }
  v89=v32[0];
  v90=v32[1];
  if(v89!==v33[0]||v90!==v33[1]){
  v1.sampleCoverage(v89,v90);
  v33[0]=v89;
  v33[1]=v90;
  }
  v91=v4.stencil_enable;
  if(v91!==v5.stencil_enable){
  if(v91){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v91;
  }
  v92=v4.stencil_mask;
  if(v92!==v5.stencil_mask){
  v1.stencilMask(v92);
  v5.stencil_mask=v92;
  }
  v93=v34[0];
  v94=v34[1];
  v95=v34[2];
  if(v93!==v35[0]||v94!==v35[1]||v95!==v35[2]){
  v1.stencilFunc(v93,v94,v95);
  v35[0]=v93;
  v35[1]=v94;
  v35[2]=v95;
  }
  v96=v36[0];
  v97=v36[1];
  v98=v36[2];
  v99=v36[3];
  if(v96!==v37[0]||v97!==v37[1]||v98!==v37[2]||v99!==v37[3]){
  v1.stencilOpSeparate(v96,v97,v98,v99);
  v37[0]=v96;
  v37[1]=v97;
  v37[2]=v98;
  v37[3]=v99;
  }
  v100=v38[0];
  v101=v38[1];
  v102=v38[2];
  v103=v38[3];
  if(v100!==v39[0]||v101!==v39[1]||v102!==v39[2]||v103!==v39[3]){
  v1.stencilOpSeparate(v100,v101,v102,v103);
  v39[0]=v100;
  v39[1]=v101;
  v39[2]=v102;
  v39[3]=v103;
  }
  v104=v4.scissor_enable;
  if(v104!==v5.scissor_enable){
  if(v104){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v104;
  }
  }
  v105=v2.framebufferWidth;
  v106=v2.framebufferHeight;
  v107=v2.viewportWidth;
  v2.viewportWidth=v105;
  v108=v2.viewportHeight;
  v2.viewportHeight=v106;
  v1.viewport(0,0,v105,v106);
  v43[0]=0;
  v43[1]=0;
  v43[2]=v105;
  v43[3]=v106;
  v109=v2.framebufferWidth;
  v110=v2.framebufferHeight;
  v1.scissor(0,0,v109,v110);
  v41[0]=0;
  v41[1]=0;
  v41[2]=v109;
  v41[3]=v110;
  v111=v5.profile;
  if(v111){
  v112=performance.now();
  g52.count++;
  }
  v113=v9.frag;
  v114=v9.vert;
  v115=v9.program(v114,v113,g19);
  v1.useProgram(v115.program);
  v11.setVAO(null);
  v117=v115.id;
  v118=v116[v117];
  if(v118){
  v118.call(this,a0);
  }
  else{
  v118=v116[v117]=g119(v115);
  v118.call(this,a0);
  }
  v5.dirty=true;
  v11.setVAO(null);
  v13.next=v56;
  v2.framebufferWidth=v57;
  v2.framebufferHeight=v58;
  v2.viewportWidth=v107;
  v2.viewportHeight=v108;
  if(v111){
  g52.cpuTime+=performance.now()-v112;
  }
  }
  ,"scope":function(a0,a1,a2){
  var v120,v121,v122,v123,v124,v125,v126,v127,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140;
  v120=a0["framebuffer"];
  v121=v13.getFramebuffer(v120);
  if(!(!v120||v121))g18.commandRaise(g55,g19);
  v122=v13.next;
  v13.next=v121;
  v123=v2.framebufferWidth;
  v2.framebufferWidth=v121?v121.width:v2.drawingBufferWidth;
  v124=v2.framebufferHeight;
  v2.framebufferHeight=v121?v121.height:v2.drawingBufferHeight;
  v125=v2.framebufferWidth;
  v126=v2.framebufferHeight;
  v127=v2.viewportWidth;
  v2.viewportWidth=v125;
  v128=v2.viewportHeight;
  v2.viewportHeight=v126;
  v129=v42[0];
  v42[0]=_gs[0];
  v130=v42[1];
  v42[1]=_gs[1];
  v131=v42[2];
  v42[2]=_gs[2];
  v132=v42[3];
  v42[3]=_gs[3];
  v133=v2.framebufferWidth;
  v134=v2.framebufferHeight;
  v135=v40[0];
  v40[0]=_gs[4];
  v136=v40[1];
  v40[1]=_gs[5];
  v137=v40[2];
  v40[2]=_gs[6];
  v138=v40[3];
  v40[3]=_gs[7];
  v139=v5.profile;
  if(v139){
  v140=performance.now();
  g52.count++;
  }
  v5.dirty=true;
  a1(v2,a0,a2);
  v13.next=v122;
  v2.framebufferWidth=v123;
  v2.framebufferHeight=v124;
  v2.viewportWidth=v127;
  v2.viewportHeight=v128;
  v42[0]=v129;
  v42[1]=v130;
  v42[2]=v131;
  v42[3]=v132;
  v40[0]=v135;
  v40[1]=v136;
  v40[2]=v137;
  v40[3]=v138;
  if(v139){
  g52.cpuTime+=performance.now()-v140;
  }
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v187,v188,v189,v190,v191,v193,v194;
  if(v5.dirty){
  var v141,v142,v143,v144,v145,v146,v147,v148,v149,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v165,v166,v167,v168,v169,v170,v171,v172,v173,v174,v175,v176,v177,v178,v179,v180,v181,v182,v183,v184,v185,v186;
  v141=v4.dither;
  if(v141!==v5.dither){
  if(v141){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v141;
  }
  v142=v4.blend_enable;
  if(v142!==v5.blend_enable){
  if(v142){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v142;
  }
  v143=v20[0];
  v144=v20[1];
  v145=v20[2];
  v146=v20[3];
  if(v143!==v21[0]||v144!==v21[1]||v145!==v21[2]||v146!==v21[3]){
  v1.blendColor(v143,v144,v145,v146);
  v21[0]=v143;
  v21[1]=v144;
  v21[2]=v145;
  v21[3]=v146;
  }
  v147=v22[0];
  v148=v22[1];
  if(v147!==v23[0]||v148!==v23[1]){
  v1.blendEquationSeparate(v147,v148);
  v23[0]=v147;
  v23[1]=v148;
  }
  v149=v24[0];
  v150=v24[1];
  v151=v24[2];
  v152=v24[3];
  if(v149!==v25[0]||v150!==v25[1]||v151!==v25[2]||v152!==v25[3]){
  v1.blendFuncSeparate(v149,v150,v151,v152);
  v25[0]=v149;
  v25[1]=v150;
  v25[2]=v151;
  v25[3]=v152;
  }
  v153=v4.depth_enable;
  if(v153!==v5.depth_enable){
  if(v153){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v153;
  }
  v154=v4.depth_func;
  if(v154!==v5.depth_func){
  v1.depthFunc(v154);
  v5.depth_func=v154;
  }
  v155=v26[0];
  v156=v26[1];
  if(v155!==v27[0]||v156!==v27[1]){
  v1.depthRange(v155,v156);
  v27[0]=v155;
  v27[1]=v156;
  }
  v157=v4.depth_mask;
  if(v157!==v5.depth_mask){
  v1.depthMask(v157);
  v5.depth_mask=v157;
  }
  v158=v28[0];
  v159=v28[1];
  v160=v28[2];
  v161=v28[3];
  if(v158!==v29[0]||v159!==v29[1]||v160!==v29[2]||v161!==v29[3]){
  v1.colorMask(v158,v159,v160,v161);
  v29[0]=v158;
  v29[1]=v159;
  v29[2]=v160;
  v29[3]=v161;
  }
  v162=v4.cull_enable;
  if(v162!==v5.cull_enable){
  if(v162){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v162;
  }
  v163=v4.cull_face;
  if(v163!==v5.cull_face){
  v1.cullFace(v163);
  v5.cull_face=v163;
  }
  v164=v4.frontFace;
  if(v164!==v5.frontFace){
  v1.frontFace(v164);
  v5.frontFace=v164;
  }
  v165=v4.lineWidth;
  if(v165!==v5.lineWidth){
  v1.lineWidth(v165);
  v5.lineWidth=v165;
  }
  v166=v4.polygonOffset_enable;
  if(v166!==v5.polygonOffset_enable){
  if(v166){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v166;
  }
  v167=v30[0];
  v168=v30[1];
  if(v167!==v31[0]||v168!==v31[1]){
  v1.polygonOffset(v167,v168);
  v31[0]=v167;
  v31[1]=v168;
  }
  v169=v4.sample_alpha;
  if(v169!==v5.sample_alpha){
  if(v169){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v169;
  }
  v170=v4.sample_enable;
  if(v170!==v5.sample_enable){
  if(v170){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v170;
  }
  v171=v32[0];
  v172=v32[1];
  if(v171!==v33[0]||v172!==v33[1]){
  v1.sampleCoverage(v171,v172);
  v33[0]=v171;
  v33[1]=v172;
  }
  v173=v4.stencil_enable;
  if(v173!==v5.stencil_enable){
  if(v173){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v173;
  }
  v174=v4.stencil_mask;
  if(v174!==v5.stencil_mask){
  v1.stencilMask(v174);
  v5.stencil_mask=v174;
  }
  v175=v34[0];
  v176=v34[1];
  v177=v34[2];
  if(v175!==v35[0]||v176!==v35[1]||v177!==v35[2]){
  v1.stencilFunc(v175,v176,v177);
  v35[0]=v175;
  v35[1]=v176;
  v35[2]=v177;
  }
  v178=v36[0];
  v179=v36[1];
  v180=v36[2];
  v181=v36[3];
  if(v178!==v37[0]||v179!==v37[1]||v180!==v37[2]||v181!==v37[3]){
  v1.stencilOpSeparate(v178,v179,v180,v181);
  v37[0]=v178;
  v37[1]=v179;
  v37[2]=v180;
  v37[3]=v181;
  }
  v182=v38[0];
  v183=v38[1];
  v184=v38[2];
  v185=v38[3];
  if(v182!==v39[0]||v183!==v39[1]||v184!==v39[2]||v185!==v39[3]){
  v1.stencilOpSeparate(v182,v183,v184,v185);
  v39[0]=v182;
  v39[1]=v183;
  v39[2]=v184;
  v39[3]=v185;
  }
  v186=v4.scissor_enable;
  if(v186!==v5.scissor_enable){
  if(v186){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v186;
  }
  }
  v187=v5.profile;
  if(v187){
  v188=performance.now();
  g52.count+=a1;
  }
  v189=v9.frag;
  v190=v9.vert;
  v191=v9.program(v190,v189,g19);
  v1.useProgram(v191.program);
  v11.setVAO(null);
  v193=v191.id;
  v194=v192[v193];
  if(v194){
  v194.call(this,a0,a1);
  }
  else{
  v194=v192[v193]=g195(v191);
  v194.call(this,a0,a1);
  }
  v5.dirty=true;
  v11.setVAO(null);
  if(v187){
  g52.cpuTime+=performance.now()-v188;
  }
  }
  ,}
  
  },
  "9814.14": function (_gs, g0, g18, g19, g54) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v65,v66,v67,v68,v69,v70,v73,v74,v77,v78,v85,v86,v87,v88,v91,v92,v93,v94,v95,v96,v97,v98,v99,v100;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v65=v4.blend_color;
  v66=v5.blend_color;
  v67=v4.blend_equation;
  v68=v5.blend_equation;
  v69=v4.blend_func;
  v70=v5.blend_func;
  v73=v4.depth_range;
  v74=v5.depth_range;
  v77=v4.colorMask;
  v78=v5.colorMask;
  v85=v4.polygonOffset_offset;
  v86=v5.polygonOffset_offset;
  v87=v4.sample_coverage;
  v88=v5.sample_coverage;
  v91=v4.stencil_func;
  v92=v5.stencil_func;
  v93=v4.stencil_opFront;
  v94=v5.stencil_opFront;
  v95=v4.stencil_opBack;
  v96=v5.stencil_opBack;
  v97=v4.scissor_box;
  v98=v5.scissor_box;
  v99=v4.viewport;
  v100=v5.viewport;
  return {
  "poll":function(){
  var v52;
  var v56,v57,v58,v59,v60,v61,v62,v63,v64,v71,v72,v75,v76,v79,v80,v81,v82,v83,v84,v89,v90;
  v5.dirty=false;
  v56=v4.dither;
  v57=v4.blend_enable;
  v58=v4.depth_enable;
  v59=v4.cull_enable;
  v60=v4.polygonOffset_enable;
  v61=v4.sample_alpha;
  v62=v4.sample_enable;
  v63=v4.stencil_enable;
  v64=v4.scissor_enable;
  v71=v4.depth_func;
  v72=v5.depth_func;
  v75=v4.depth_mask;
  v76=v5.depth_mask;
  v79=v4.cull_face;
  v80=v5.cull_face;
  v81=v4.frontFace;
  v82=v5.frontFace;
  v83=v4.lineWidth;
  v84=v5.lineWidth;
  v89=v4.stencil_mask;
  v90=v5.stencil_mask;
  v52=v13.next;
  if(v52!==v13.cur){
  if(v52){
  v1.bindFramebuffer(36160,v52.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v52;
  }
  if(v56!==v5.dither){
  if(v56){
  v1.enable(3024)}
  else{
  v1.disable(3024)}
  v5.dither=v56;
  }
  if(v57!==v5.blend_enable){
  if(v57){
  v1.enable(3042)}
  else{
  v1.disable(3042)}
  v5.blend_enable=v57;
  }
  if(v58!==v5.depth_enable){
  if(v58){
  v1.enable(2929)}
  else{
  v1.disable(2929)}
  v5.depth_enable=v58;
  }
  if(v59!==v5.cull_enable){
  if(v59){
  v1.enable(2884)}
  else{
  v1.disable(2884)}
  v5.cull_enable=v59;
  }
  if(v60!==v5.polygonOffset_enable){
  if(v60){
  v1.enable(32823)}
  else{
  v1.disable(32823)}
  v5.polygonOffset_enable=v60;
  }
  if(v61!==v5.sample_alpha){
  if(v61){
  v1.enable(32926)}
  else{
  v1.disable(32926)}
  v5.sample_alpha=v61;
  }
  if(v62!==v5.sample_enable){
  if(v62){
  v1.enable(32928)}
  else{
  v1.disable(32928)}
  v5.sample_enable=v62;
  }
  if(v63!==v5.stencil_enable){
  if(v63){
  v1.enable(2960)}
  else{
  v1.disable(2960)}
  v5.stencil_enable=v63;
  }
  if(v64!==v5.scissor_enable){
  if(v64){
  v1.enable(3089)}
  else{
  v1.disable(3089)}
  v5.scissor_enable=v64;
  }
  if(v65[0]!==v66[0]||v65[1]!==v66[1]||v65[2]!==v66[2]||v65[3]!==v66[3]){
  v1.blendColor(v65[0],v65[1],v65[2],v65[3]);
  v66[0]=v65[0];
  v66[1]=v65[1];
  v66[2]=v65[2];
  v66[3]=v65[3];
  }
  if(v67[0]!==v68[0]||v67[1]!==v68[1]){
  v1.blendEquationSeparate(v67[0],v67[1]);
  v68[0]=v67[0];
  v68[1]=v67[1];
  }
  if(v69[0]!==v70[0]||v69[1]!==v70[1]||v69[2]!==v70[2]||v69[3]!==v70[3]){
  v1.blendFuncSeparate(v69[0],v69[1],v69[2],v69[3]);
  v70[0]=v69[0];
  v70[1]=v69[1];
  v70[2]=v69[2];
  v70[3]=v69[3];
  }
  if(v71!==v72){
  v1.depthFunc(v71);
  v5.depth_func=v71;
  }
  if(v73[0]!==v74[0]||v73[1]!==v74[1]){
  v1.depthRange(v73[0],v73[1]);
  v74[0]=v73[0];
  v74[1]=v73[1];
  }
  if(v75!==v76){
  v1.depthMask(v75);
  v5.depth_mask=v75;
  }
  if(v77[0]!==v78[0]||v77[1]!==v78[1]||v77[2]!==v78[2]||v77[3]!==v78[3]){
  v1.colorMask(v77[0],v77[1],v77[2],v77[3]);
  v78[0]=v77[0];
  v78[1]=v77[1];
  v78[2]=v77[2];
  v78[3]=v77[3];
  }
  if(v79!==v80){
  v1.cullFace(v79);
  v5.cull_face=v79;
  }
  if(v81!==v82){
  v1.frontFace(v81);
  v5.frontFace=v81;
  }
  if(v83!==v84){
  v1.lineWidth(v83);
  v5.lineWidth=v83;
  }
  if(v85[0]!==v86[0]||v85[1]!==v86[1]){
  v1.polygonOffset(v85[0],v85[1]);
  v86[0]=v85[0];
  v86[1]=v85[1];
  }
  if(v87[0]!==v88[0]||v87[1]!==v88[1]){
  v1.sampleCoverage(v87[0],v87[1]);
  v88[0]=v87[0];
  v88[1]=v87[1];
  }
  if(v89!==v90){
  v1.stencilMask(v89);
  v5.stencil_mask=v89;
  }
  if(v91[0]!==v92[0]||v91[1]!==v92[1]||v91[2]!==v92[2]){
  v1.stencilFunc(v91[0],v91[1],v91[2]);
  v92[0]=v91[0];
  v92[1]=v91[1];
  v92[2]=v91[2];
  }
  if(v93[0]!==v94[0]||v93[1]!==v94[1]||v93[2]!==v94[2]||v93[3]!==v94[3]){
  v1.stencilOpSeparate(v93[0],v93[1],v93[2],v93[3]);
  v94[0]=v93[0];
  v94[1]=v93[1];
  v94[2]=v93[2];
  v94[3]=v93[3];
  }
  if(v95[0]!==v96[0]||v95[1]!==v96[1]||v95[2]!==v96[2]||v95[3]!==v96[3]){
  v1.stencilOpSeparate(v95[0],v95[1],v95[2],v95[3]);
  v96[0]=v95[0];
  v96[1]=v95[1];
  v96[2]=v95[2];
  v96[3]=v95[3];
  }
  if(v97[0]!==v98[0]||v97[1]!==v98[1]||v97[2]!==v98[2]||v97[3]!==v98[3]){
  v1.scissor(v97[0],v97[1],v97[2],v97[3]);
  v98[0]=v97[0];
  v98[1]=v97[1];
  v98[2]=v97[2];
  v98[3]=v97[3];
  }
  if(v99[0]!==v100[0]||v99[1]!==v100[1]||v99[2]!==v100[2]||v99[3]!==v100[3]){
  v1.viewport(v99[0],v99[1],v99[2],v99[3]);
  v100[0]=v99[0];
  v100[1]=v99[1];
  v100[2]=v99[2];
  v100[3]=v99[3];
  }
  }
  ,"refresh":function(){
  var v53,v55;
  var v56,v57,v58,v59,v60,v61,v62,v63,v64,v71,v72,v75,v76,v79,v80,v81,v82,v83,v84,v89,v90;
  v5.dirty=false;
  v56=v4.dither;
  v57=v4.blend_enable;
  v58=v4.depth_enable;
  v59=v4.cull_enable;
  v60=v4.polygonOffset_enable;
  v61=v4.sample_alpha;
  v62=v4.sample_enable;
  v63=v4.stencil_enable;
  v64=v4.scissor_enable;
  v71=v4.depth_func;
  v72=v5.depth_func;
  v75=v4.depth_mask;
  v76=v5.depth_mask;
  v79=v4.cull_face;
  v80=v5.cull_face;
  v81=v4.frontFace;
  v82=v5.frontFace;
  v83=v4.lineWidth;
  v84=v5.lineWidth;
  v89=v4.stencil_mask;
  v90=v5.stencil_mask;
  v53=v13.next;
  if(v53){
  v1.bindFramebuffer(36160,v53.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v53;
  v55=v10;
  for(var i=0;
  i<g54;
  ++i){
  if(v55[i].buffer){
  v1.enableVertexAttribArray(i);
  v1.bindBuffer(34962,v55[i].buffer.buffer);
  v1.vertexAttribPointer(i,v55[i].size,v55[i].type,v55[i].normalized,v55[i].stride,v55[i].offset);
  }
  else{
  v1.disableVertexAttribArray(i);
  v1.vertexAttrib4f(i,v55[i].x,v55[i].y,v55[i].z,v55[i].w);
  v55[i].buffer=null;
  }
  }
  v11.currentVAO=null;
  v11.setVAO(v11.targetVAO);
  if(v56){
  v1.enable(3024)}
  else{
  v1.disable(3024)}
  v5.dither=v56;
  if(v57){
  v1.enable(3042)}
  else{
  v1.disable(3042)}
  v5.blend_enable=v57;
  if(v58){
  v1.enable(2929)}
  else{
  v1.disable(2929)}
  v5.depth_enable=v58;
  if(v59){
  v1.enable(2884)}
  else{
  v1.disable(2884)}
  v5.cull_enable=v59;
  if(v60){
  v1.enable(32823)}
  else{
  v1.disable(32823)}
  v5.polygonOffset_enable=v60;
  if(v61){
  v1.enable(32926)}
  else{
  v1.disable(32926)}
  v5.sample_alpha=v61;
  if(v62){
  v1.enable(32928)}
  else{
  v1.disable(32928)}
  v5.sample_enable=v62;
  if(v63){
  v1.enable(2960)}
  else{
  v1.disable(2960)}
  v5.stencil_enable=v63;
  if(v64){
  v1.enable(3089)}
  else{
  v1.disable(3089)}
  v5.scissor_enable=v64;
  v1.blendColor(v65[0],v65[1],v65[2],v65[3]);
  v66[0]=v65[0];
  v66[1]=v65[1];
  v66[2]=v65[2];
  v66[3]=v65[3];
  v1.blendEquationSeparate(v67[0],v67[1]);
  v68[0]=v67[0];
  v68[1]=v67[1];
  v1.blendFuncSeparate(v69[0],v69[1],v69[2],v69[3]);
  v70[0]=v69[0];
  v70[1]=v69[1];
  v70[2]=v69[2];
  v70[3]=v69[3];
  v1.depthFunc(v71);
  v5.depth_func=v71;
  v1.depthRange(v73[0],v73[1]);
  v74[0]=v73[0];
  v74[1]=v73[1];
  v1.depthMask(v75);
  v5.depth_mask=v75;
  v1.colorMask(v77[0],v77[1],v77[2],v77[3]);
  v78[0]=v77[0];
  v78[1]=v77[1];
  v78[2]=v77[2];
  v78[3]=v77[3];
  v1.cullFace(v79);
  v5.cull_face=v79;
  v1.frontFace(v81);
  v5.frontFace=v81;
  v1.lineWidth(v83);
  v5.lineWidth=v83;
  v1.polygonOffset(v85[0],v85[1]);
  v86[0]=v85[0];
  v86[1]=v85[1];
  v1.sampleCoverage(v87[0],v87[1]);
  v88[0]=v87[0];
  v88[1]=v87[1];
  v1.stencilMask(v89);
  v5.stencil_mask=v89;
  v1.stencilFunc(v91[0],v91[1],v91[2]);
  v92[0]=v91[0];
  v92[1]=v91[1];
  v92[2]=v91[2];
  v1.stencilOpSeparate(v93[0],v93[1],v93[2],v93[3]);
  v94[0]=v93[0];
  v94[1]=v93[1];
  v94[2]=v93[2];
  v94[3]=v93[3];
  v1.stencilOpSeparate(v95[0],v95[1],v95[2],v95[3]);
  v96[0]=v95[0];
  v96[1]=v95[1];
  v96[2]=v95[2];
  v96[3]=v95[3];
  v1.scissor(v97[0],v97[1],v97[2],v97[3]);
  v98[0]=v97[0];
  v98[1]=v97[1];
  v98[2]=v97[2];
  v98[3]=v97[3];
  v1.viewport(v99[0],v99[1],v99[2],v99[3]);
  v100[0]=v99[0];
  v100[1]=v99[1];
  v100[2]=v99[2];
  v100[3]=v99[3];
  }
  ,}
  
  },
  "11732.24": function (_gs, g0, g18, g19, g52, g116, g182) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v113,v179;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v113={
  }
  ;
  v179={
  }
  ;
  return {
  "draw":function(a0){
  var v53,v108,v109,v110,v111,v112,v114,v115;
  v53=v13.next;
  if(v53!==v13.cur){
  if(v53){
  v1.bindFramebuffer(36160,v53.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v53;
  }
  if(v5.dirty){
  var v54,v55,v56,v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95,v96,v97,v98,v99,v100,v101,v102,v103,v104,v105,v106,v107;
  v54=v4.dither;
  if(v54!==v5.dither){
  if(v54){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v54;
  }
  v55=v4.blend_enable;
  if(v55!==v5.blend_enable){
  if(v55){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v55;
  }
  v56=v20[0];
  v57=v20[1];
  v58=v20[2];
  v59=v20[3];
  if(v56!==v21[0]||v57!==v21[1]||v58!==v21[2]||v59!==v21[3]){
  v1.blendColor(v56,v57,v58,v59);
  v21[0]=v56;
  v21[1]=v57;
  v21[2]=v58;
  v21[3]=v59;
  }
  v60=v22[0];
  v61=v22[1];
  if(v60!==v23[0]||v61!==v23[1]){
  v1.blendEquationSeparate(v60,v61);
  v23[0]=v60;
  v23[1]=v61;
  }
  v62=v24[0];
  v63=v24[1];
  v64=v24[2];
  v65=v24[3];
  if(v62!==v25[0]||v63!==v25[1]||v64!==v25[2]||v65!==v25[3]){
  v1.blendFuncSeparate(v62,v63,v64,v65);
  v25[0]=v62;
  v25[1]=v63;
  v25[2]=v64;
  v25[3]=v65;
  }
  v66=v4.depth_enable;
  if(v66!==v5.depth_enable){
  if(v66){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v66;
  }
  v67=v4.depth_func;
  if(v67!==v5.depth_func){
  v1.depthFunc(v67);
  v5.depth_func=v67;
  }
  v68=v26[0];
  v69=v26[1];
  if(v68!==v27[0]||v69!==v27[1]){
  v1.depthRange(v68,v69);
  v27[0]=v68;
  v27[1]=v69;
  }
  v70=v4.depth_mask;
  if(v70!==v5.depth_mask){
  v1.depthMask(v70);
  v5.depth_mask=v70;
  }
  v71=v28[0];
  v72=v28[1];
  v73=v28[2];
  v74=v28[3];
  if(v71!==v29[0]||v72!==v29[1]||v73!==v29[2]||v74!==v29[3]){
  v1.colorMask(v71,v72,v73,v74);
  v29[0]=v71;
  v29[1]=v72;
  v29[2]=v73;
  v29[3]=v74;
  }
  v75=v4.cull_enable;
  if(v75!==v5.cull_enable){
  if(v75){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v75;
  }
  v76=v4.cull_face;
  if(v76!==v5.cull_face){
  v1.cullFace(v76);
  v5.cull_face=v76;
  }
  v77=v4.frontFace;
  if(v77!==v5.frontFace){
  v1.frontFace(v77);
  v5.frontFace=v77;
  }
  v78=v4.lineWidth;
  if(v78!==v5.lineWidth){
  v1.lineWidth(v78);
  v5.lineWidth=v78;
  }
  v79=v4.polygonOffset_enable;
  if(v79!==v5.polygonOffset_enable){
  if(v79){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v79;
  }
  v80=v30[0];
  v81=v30[1];
  if(v80!==v31[0]||v81!==v31[1]){
  v1.polygonOffset(v80,v81);
  v31[0]=v80;
  v31[1]=v81;
  }
  v82=v4.sample_alpha;
  if(v82!==v5.sample_alpha){
  if(v82){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v82;
  }
  v83=v4.sample_enable;
  if(v83!==v5.sample_enable){
  if(v83){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v83;
  }
  v84=v32[0];
  v85=v32[1];
  if(v84!==v33[0]||v85!==v33[1]){
  v1.sampleCoverage(v84,v85);
  v33[0]=v84;
  v33[1]=v85;
  }
  v86=v4.stencil_enable;
  if(v86!==v5.stencil_enable){
  if(v86){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v86;
  }
  v87=v4.stencil_mask;
  if(v87!==v5.stencil_mask){
  v1.stencilMask(v87);
  v5.stencil_mask=v87;
  }
  v88=v34[0];
  v89=v34[1];
  v90=v34[2];
  if(v88!==v35[0]||v89!==v35[1]||v90!==v35[2]){
  v1.stencilFunc(v88,v89,v90);
  v35[0]=v88;
  v35[1]=v89;
  v35[2]=v90;
  }
  v91=v36[0];
  v92=v36[1];
  v93=v36[2];
  v94=v36[3];
  if(v91!==v37[0]||v92!==v37[1]||v93!==v37[2]||v94!==v37[3]){
  v1.stencilOpSeparate(v91,v92,v93,v94);
  v37[0]=v91;
  v37[1]=v92;
  v37[2]=v93;
  v37[3]=v94;
  }
  v95=v38[0];
  v96=v38[1];
  v97=v38[2];
  v98=v38[3];
  if(v95!==v39[0]||v96!==v39[1]||v97!==v39[2]||v98!==v39[3]){
  v1.stencilOpSeparate(v95,v96,v97,v98);
  v39[0]=v95;
  v39[1]=v96;
  v39[2]=v97;
  v39[3]=v98;
  }
  v99=v4.scissor_enable;
  if(v99!==v5.scissor_enable){
  if(v99){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v99;
  }
  v100=v40[0];
  v101=v40[1];
  v102=v40[2];
  v103=v40[3];
  if(v100!==v41[0]||v101!==v41[1]||v102!==v41[2]||v103!==v41[3]){
  v1.scissor(v100,v101,v102,v103);
  v41[0]=v100;
  v41[1]=v101;
  v41[2]=v102;
  v41[3]=v103;
  }
  v104=v42[0];
  v105=v42[1];
  v106=v42[2];
  v107=v42[3];
  if(v104!==v43[0]||v105!==v43[1]||v106!==v43[2]||v107!==v43[3]){
  v1.viewport(v104,v105,v106,v107);
  v43[0]=v104;
  v43[1]=v105;
  v43[2]=v106;
  v43[3]=v107;
  }
  v5.dirty=false;
  }
  v108=v5.profile;
  if(v108){
  v109=performance.now();
  g52.count++;
  }
  v110=v9.frag;
  v111=v9.vert;
  v112=v9.program(v111,v110,g19);
  v1.useProgram(v112.program);
  v11.setVAO(null);
  v114=v112.id;
  v115=v113[v114];
  if(v115){
  v115.call(this,a0);
  }
  else{
  v115=v113[v114]=g116(v112);
  v115.call(this,a0);
  }
  v11.setVAO(null);
  if(v108){
  g52.cpuTime+=performance.now()-v109;
  }
  }
  ,"scope":function(a0,a1,a2){
  var v117,v118;
  v117=v5.profile;
  if(v117){
  v118=performance.now();
  g52.count++;
  }
  a1(v2,a0,a2);
  if(v117){
  g52.cpuTime+=performance.now()-v118;
  }
  }
  ,"batch":function(a0,a1){
  var v119,v174,v175,v176,v177,v178,v180,v181;
  v119=v13.next;
  if(v119!==v13.cur){
  if(v119){
  v1.bindFramebuffer(36160,v119.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v119;
  }
  if(v5.dirty){
  var v120,v121,v122,v123,v124,v125,v126,v127,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,v142,v143,v144,v145,v146,v147,v148,v149,v150,v151,v152,v153,v154,v155,v156,v157,v158,v159,v160,v161,v162,v163,v164,v165,v166,v167,v168,v169,v170,v171,v172,v173;
  v120=v4.dither;
  if(v120!==v5.dither){
  if(v120){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=v120;
  }
  v121=v4.blend_enable;
  if(v121!==v5.blend_enable){
  if(v121){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=v121;
  }
  v122=v20[0];
  v123=v20[1];
  v124=v20[2];
  v125=v20[3];
  if(v122!==v21[0]||v123!==v21[1]||v124!==v21[2]||v125!==v21[3]){
  v1.blendColor(v122,v123,v124,v125);
  v21[0]=v122;
  v21[1]=v123;
  v21[2]=v124;
  v21[3]=v125;
  }
  v126=v22[0];
  v127=v22[1];
  if(v126!==v23[0]||v127!==v23[1]){
  v1.blendEquationSeparate(v126,v127);
  v23[0]=v126;
  v23[1]=v127;
  }
  v128=v24[0];
  v129=v24[1];
  v130=v24[2];
  v131=v24[3];
  if(v128!==v25[0]||v129!==v25[1]||v130!==v25[2]||v131!==v25[3]){
  v1.blendFuncSeparate(v128,v129,v130,v131);
  v25[0]=v128;
  v25[1]=v129;
  v25[2]=v130;
  v25[3]=v131;
  }
  v132=v4.depth_enable;
  if(v132!==v5.depth_enable){
  if(v132){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=v132;
  }
  v133=v4.depth_func;
  if(v133!==v5.depth_func){
  v1.depthFunc(v133);
  v5.depth_func=v133;
  }
  v134=v26[0];
  v135=v26[1];
  if(v134!==v27[0]||v135!==v27[1]){
  v1.depthRange(v134,v135);
  v27[0]=v134;
  v27[1]=v135;
  }
  v136=v4.depth_mask;
  if(v136!==v5.depth_mask){
  v1.depthMask(v136);
  v5.depth_mask=v136;
  }
  v137=v28[0];
  v138=v28[1];
  v139=v28[2];
  v140=v28[3];
  if(v137!==v29[0]||v138!==v29[1]||v139!==v29[2]||v140!==v29[3]){
  v1.colorMask(v137,v138,v139,v140);
  v29[0]=v137;
  v29[1]=v138;
  v29[2]=v139;
  v29[3]=v140;
  }
  v141=v4.cull_enable;
  if(v141!==v5.cull_enable){
  if(v141){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=v141;
  }
  v142=v4.cull_face;
  if(v142!==v5.cull_face){
  v1.cullFace(v142);
  v5.cull_face=v142;
  }
  v143=v4.frontFace;
  if(v143!==v5.frontFace){
  v1.frontFace(v143);
  v5.frontFace=v143;
  }
  v144=v4.lineWidth;
  if(v144!==v5.lineWidth){
  v1.lineWidth(v144);
  v5.lineWidth=v144;
  }
  v145=v4.polygonOffset_enable;
  if(v145!==v5.polygonOffset_enable){
  if(v145){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v145;
  }
  v146=v30[0];
  v147=v30[1];
  if(v146!==v31[0]||v147!==v31[1]){
  v1.polygonOffset(v146,v147);
  v31[0]=v146;
  v31[1]=v147;
  }
  v148=v4.sample_alpha;
  if(v148!==v5.sample_alpha){
  if(v148){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v148;
  }
  v149=v4.sample_enable;
  if(v149!==v5.sample_enable){
  if(v149){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v149;
  }
  v150=v32[0];
  v151=v32[1];
  if(v150!==v33[0]||v151!==v33[1]){
  v1.sampleCoverage(v150,v151);
  v33[0]=v150;
  v33[1]=v151;
  }
  v152=v4.stencil_enable;
  if(v152!==v5.stencil_enable){
  if(v152){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v152;
  }
  v153=v4.stencil_mask;
  if(v153!==v5.stencil_mask){
  v1.stencilMask(v153);
  v5.stencil_mask=v153;
  }
  v154=v34[0];
  v155=v34[1];
  v156=v34[2];
  if(v154!==v35[0]||v155!==v35[1]||v156!==v35[2]){
  v1.stencilFunc(v154,v155,v156);
  v35[0]=v154;
  v35[1]=v155;
  v35[2]=v156;
  }
  v157=v36[0];
  v158=v36[1];
  v159=v36[2];
  v160=v36[3];
  if(v157!==v37[0]||v158!==v37[1]||v159!==v37[2]||v160!==v37[3]){
  v1.stencilOpSeparate(v157,v158,v159,v160);
  v37[0]=v157;
  v37[1]=v158;
  v37[2]=v159;
  v37[3]=v160;
  }
  v161=v38[0];
  v162=v38[1];
  v163=v38[2];
  v164=v38[3];
  if(v161!==v39[0]||v162!==v39[1]||v163!==v39[2]||v164!==v39[3]){
  v1.stencilOpSeparate(v161,v162,v163,v164);
  v39[0]=v161;
  v39[1]=v162;
  v39[2]=v163;
  v39[3]=v164;
  }
  v165=v4.scissor_enable;
  if(v165!==v5.scissor_enable){
  if(v165){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=v165;
  }
  v166=v40[0];
  v167=v40[1];
  v168=v40[2];
  v169=v40[3];
  if(v166!==v41[0]||v167!==v41[1]||v168!==v41[2]||v169!==v41[3]){
  v1.scissor(v166,v167,v168,v169);
  v41[0]=v166;
  v41[1]=v167;
  v41[2]=v168;
  v41[3]=v169;
  }
  v170=v42[0];
  v171=v42[1];
  v172=v42[2];
  v173=v42[3];
  if(v170!==v43[0]||v171!==v43[1]||v172!==v43[2]||v173!==v43[3]){
  v1.viewport(v170,v171,v172,v173);
  v43[0]=v170;
  v43[1]=v171;
  v43[2]=v172;
  v43[3]=v173;
  }
  v5.dirty=false;
  }
  v174=v5.profile;
  if(v174){
  v175=performance.now();
  g52.count+=a1;
  }
  v176=v9.frag;
  v177=v9.vert;
  v178=v9.program(v177,v176,g19);
  v1.useProgram(v178.program);
  v11.setVAO(null);
  v180=v178.id;
  v181=v179[v180];
  if(v181){
  v181.call(this,a0,a1);
  }
  else{
  v181=v179[v180]=g182(v178);
  v181.call(this,a0,a1);
  }
  v11.setVAO(null);
  if(v174){
  g52.cpuTime+=performance.now()-v175;
  }
  }
  ,}
  
  },
  "59191.522": function (_gs, g0, g18, g19, g52, g85, g96, g102, g103, g104, g107, g108, g111, g112, g115, g116, g119, g120, g123, g124, g127, g128, g131, g132, g135, g136, g139, g140, g143, g144, g147, g148, g151, g152, g155, g156, g159, g160, g163, g164, g167, g169, g174, g176, g178, g180, g182, g184, g186, g188, g190, g192, g194, g196, g198, g200, g202, g204, g206, g208, g209, g211, g213, g215, g217, g219, g221, g223, g225, g227, g229, g231, g233, g235, g237, g239, g241, g243, g244, g246, g248, g249, g250, g252, g255, g257, g260, g262, g267, g269, g323, g371, g384, g397, g410, g423, g436, g449, g462, g475, g488, g501, g514, g527, g540, g553, g566) {
  "use strict";
  var v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15,v16,v17,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v53,v54,v177,v181,v185,v189,v193,v197,v201,v205,v212,v216,v220,v224,v228,v232,v236,v240,v670,v672,v674,v676,v678,v680,v682,v684,v688,v690,v692,v694,v696,v698,v700,v702;
  v1=g0.gl;
  v2=g0.context;
  v3=g0.strings;
  v4=g0.next;
  v5=g0.current;
  v6=g0.draw;
  v7=g0.elements;
  v8=g0.buffer;
  v9=g0.shader;
  v10=g0.attributes;
  v11=g0.vao;
  v12=g0.uniforms;
  v13=g0.framebuffer;
  v14=g0.extensions;
  v15=g0.timer;
  v16=g0.isBufferArgs;
  v17=g0.isArrayLike;
  v20=v4.blend_color;
  v21=v5.blend_color;
  v22=v4.blend_equation;
  v23=v5.blend_equation;
  v24=v4.blend_func;
  v25=v5.blend_func;
  v26=v4.depth_range;
  v27=v5.depth_range;
  v28=v4.colorMask;
  v29=v5.colorMask;
  v30=v4.polygonOffset_offset;
  v31=v5.polygonOffset_offset;
  v32=v4.sample_coverage;
  v33=v5.sample_coverage;
  v34=v4.stencil_func;
  v35=v5.stencil_func;
  v36=v4.stencil_opFront;
  v37=v5.stencil_opFront;
  v38=v4.stencil_opBack;
  v39=v5.stencil_opBack;
  v40=v4.scissor_box;
  v41=v5.scissor_box;
  v42=v4.viewport;
  v43=v5.viewport;
  v44={
  "points":0,"point":0,"lines":1,"line":1,"triangles":4,"triangle":4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6}
  ;
  v45={
  "never":512,"less":513,"<":513,"equal":514,"=":514,"==":514,"===":514,"lequal":515,"<=":515,"greater":516,">":516,"notequal":517,"!=":517,"!==":517,"gequal":518,">=":518,"always":519}
  ;
  v46={
  "0":0,"1":1,"zero":0,"one":1,"src color":768,"one minus src color":769,"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776}
  ;
  v47={
  "add":32774,"subtract":32778,"reverse subtract":32779}
  ;
  v48={
  "0":0,"zero":0,"keep":7680,"replace":7681,"increment":7682,"decrement":7683,"increment wrap":34055,"decrement wrap":34056,"invert":5386}
  ;
  v49={
  "int8":5120,"int16":5122,"int32":5124,"uint8":5121,"uint16":5123,"uint32":5125,"float":5126,"float32":5126}
  ;
  v50={
  "cw":2304,"ccw":2305}
  ;
  v51=["constant color, constant alpha","one minus constant color, constant alpha","constant color, one minus constant alpha","one minus constant color, one minus constant alpha","constant alpha, constant color","constant alpha, one minus constant color","one minus constant alpha, constant color","one minus constant alpha, one minus constant color"];
  v53={
  }
  ;
  v54={
  }
  ;
  v177=new Float32Array(16);
  v181=new Float32Array(16);
  v185=new Float32Array(16);
  v189=new Float32Array(16);
  v193=new Float32Array(16);
  v197=new Float32Array(16);
  v201=new Float32Array(16);
  v205=new Float32Array(16);
  v212=new Float32Array(16);
  v216=new Float32Array(16);
  v220=new Float32Array(16);
  v224=new Float32Array(16);
  v228=new Float32Array(16);
  v232=new Float32Array(16);
  v236=new Float32Array(16);
  v240=new Float32Array(16);
  v670=new Float32Array(16);
  v672=new Float32Array(16);
  v674=new Float32Array(16);
  v676=new Float32Array(16);
  v678=new Float32Array(16);
  v680=new Float32Array(16);
  v682=new Float32Array(16);
  v684=new Float32Array(16);
  v688=new Float32Array(16);
  v690=new Float32Array(16);
  v692=new Float32Array(16);
  v694=new Float32Array(16);
  v696=new Float32Array(16);
  v698=new Float32Array(16);
  v700=new Float32Array(16);
  v702=new Float32Array(16);
  return {
  "draw":function(a0){
  var v55,v81,v82,v83,v84,v86,v87,v88,v89,v90,v91,v92,v93,v94,v95,v97,v98,v99,v100,v101,v105,v106,v109,v110,v113,v114,v117,v118,v121,v122,v125,v126,v129,v130,v133,v134,v137,v138,v141,v142,v145,v146,v149,v150,v153,v154,v157,v158,v161,v162,v165,v166,v168,v170,v171,v172,v173,v175,v179,v183,v187,v191,v195,v199,v203,v207,v210,v214,v218,v222,v226,v230,v234,v238,v242,v245,v247,v251,v253,v254,v256,v258,v259,v261,v263,v264,v265,v266,v268;
  v55=v13.next;
  if(v55!==v13.cur){
  if(v55){
  v1.bindFramebuffer(36160,v55.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v55;
  }
  if(v5.dirty){
  var v56,v57,v58,v59,v60,v61,v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,v78,v79,v80;
  v56=v28[0];
  v57=v28[1];
  v58=v28[2];
  v59=v28[3];
  if(v56!==v29[0]||v57!==v29[1]||v58!==v29[2]||v59!==v29[3]){
  v1.colorMask(v56,v57,v58,v59);
  v29[0]=v56;
  v29[1]=v57;
  v29[2]=v58;
  v29[3]=v59;
  }
  v60=v4.frontFace;
  if(v60!==v5.frontFace){
  v1.frontFace(v60);
  v5.frontFace=v60;
  }
  v61=v4.polygonOffset_enable;
  if(v61!==v5.polygonOffset_enable){
  if(v61){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v61;
  }
  v62=v30[0];
  v63=v30[1];
  if(v62!==v31[0]||v63!==v31[1]){
  v1.polygonOffset(v62,v63);
  v31[0]=v62;
  v31[1]=v63;
  }
  v64=v4.sample_alpha;
  if(v64!==v5.sample_alpha){
  if(v64){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v64;
  }
  v65=v4.sample_enable;
  if(v65!==v5.sample_enable){
  if(v65){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v65;
  }
  v66=v32[0];
  v67=v32[1];
  if(v66!==v33[0]||v67!==v33[1]){
  v1.sampleCoverage(v66,v67);
  v33[0]=v66;
  v33[1]=v67;
  }
  v68=v4.stencil_enable;
  if(v68!==v5.stencil_enable){
  if(v68){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v68;
  }
  v69=v4.stencil_mask;
  if(v69!==v5.stencil_mask){
  v1.stencilMask(v69);
  v5.stencil_mask=v69;
  }
  v70=v34[0];
  v71=v34[1];
  v72=v34[2];
  if(v70!==v35[0]||v71!==v35[1]||v72!==v35[2]){
  v1.stencilFunc(v70,v71,v72);
  v35[0]=v70;
  v35[1]=v71;
  v35[2]=v72;
  }
  v73=v36[0];
  v74=v36[1];
  v75=v36[2];
  v76=v36[3];
  if(v73!==v37[0]||v74!==v37[1]||v75!==v37[2]||v76!==v37[3]){
  v1.stencilOpSeparate(v73,v74,v75,v76);
  v37[0]=v73;
  v37[1]=v74;
  v37[2]=v75;
  v37[3]=v76;
  }
  v77=v38[0];
  v78=v38[1];
  v79=v38[2];
  v80=v38[3];
  if(v77!==v39[0]||v78!==v39[1]||v79!==v39[2]||v80!==v39[3]){
  v1.stencilOpSeparate(v77,v78,v79,v80);
  v39[0]=v77;
  v39[1]=v78;
  v39[2]=v79;
  v39[3]=v80;
  }
  }
  v81=a0["viewportX"];
  v53.x=v81;
  v82=a0["viewportY"];
  v53.y=v82;
  v83=a0["viewportWidth"];
  v53.width=v83;
  v84=a0["viewportHeight"];
  v53.height=v84;
  if(!(v53&&typeof v53==="object"))g18.commandRaise(g85,g19);
  v86=v53.x|0;
  v87=v53.y|0;
  v88="width" in v53?v53.width|0:(v2.framebufferWidth-v86);
  v89="height" in v53?v53.height|0:(v2.framebufferHeight-v87);
  if(!(v88>=0&&v89>=0))g18.commandRaise(g85,g19);
  v90=v2.viewportWidth;
  v2.viewportWidth=v88;
  v91=v2.viewportHeight;
  v2.viewportHeight=v89;
  v1.viewport(v86,v87,v88,v89);
  v43[0]=v86;
  v43[1]=v87;
  v43[2]=v88;
  v43[3]=v89;
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[0]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[1];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,1,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=1;
  v25[3]=1;
  if(_gs[2]){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=_gs[3];
  v1.cullFace(_gs[4]);
  v5.cull_face=_gs[5];
  if(_gs[6]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[7];
  v1.depthFunc(_gs[8]);
  v5.depth_func=_gs[9];
  v1.depthMask(_gs[10]);
  v5.depth_mask=_gs[11];
  v1.depthRange(0,1);
  v27[0]=0;
  v27[1]=1;
  if(_gs[12]){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=_gs[13];
  v1.lineWidth(_gs[14]);
  v5.lineWidth=_gs[15];
  v92=a0["scissorX"];
  v54.x=v92;
  v93=a0["scissorY"];
  v54.y=v93;
  v94=a0["scissorWidth"];
  v54.width=v94;
  v95=a0["scissorHeight"];
  v54.height=v95;
  if(!(v54&&typeof v54==="object"))g18.commandRaise(g96,g19);
  v97=v54.x|0;
  v98=v54.y|0;
  v99="width" in v54?v54.width|0:(v2.framebufferWidth-v97);
  v100="height" in v54?v54.height|0:(v2.framebufferHeight-v98);
  if(!(v99>=0&&v100>=0))g18.commandRaise(g96,g19);
  v1.scissor(v97,v98,v99,v100);
  v41[0]=v97;
  v41[1]=v98;
  v41[2]=v99;
  v41[3]=v100;
  if(_gs[16]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[17];
  v101=v5.profile;
  v5.profile=false;
  v1.useProgram(g102.program);
  v11.setVAO(null);
  v105=g104.location;
  v106=v10[v105];
  if(!v106.buffer){
  v1.enableVertexAttribArray(v105);
  }
  if(v106.type!==g103.dtype||v106.size!==4||v106.buffer!==g103||v106.normalized!==false||v106.offset!==0||v106.stride!==0){
  v1.bindBuffer(34962,g103.buffer);
  v1.vertexAttribPointer(v105,4,g103.dtype,false,0,0);
  v106.type=g103.dtype;
  v106.size=4;
  v106.buffer=g103;
  v106.normalized=false;
  v106.offset=0;
  v106.stride=0;
  }
  v109=g108.location;
  v110=v10[v109];
  if(!v110.buffer){
  v1.enableVertexAttribArray(v109);
  }
  if(v110.type!==g107.dtype||v110.size!==4||v110.buffer!==g107||v110.normalized!==false||v110.offset!==0||v110.stride!==0){
  v1.bindBuffer(34962,g107.buffer);
  v1.vertexAttribPointer(v109,4,g107.dtype,false,0,0);
  v110.type=g107.dtype;
  v110.size=4;
  v110.buffer=g107;
  v110.normalized=false;
  v110.offset=0;
  v110.stride=0;
  }
  v113=g112.location;
  v114=v10[v113];
  if(!v114.buffer){
  v1.enableVertexAttribArray(v113);
  }
  if(v114.type!==g111.dtype||v114.size!==4||v114.buffer!==g111||v114.normalized!==false||v114.offset!==0||v114.stride!==0){
  v1.bindBuffer(34962,g111.buffer);
  v1.vertexAttribPointer(v113,4,g111.dtype,false,0,0);
  v114.type=g111.dtype;
  v114.size=4;
  v114.buffer=g111;
  v114.normalized=false;
  v114.offset=0;
  v114.stride=0;
  }
  v117=g116.location;
  v118=v10[v117];
  if(!v118.buffer){
  v1.enableVertexAttribArray(v117);
  }
  if(v118.type!==g115.dtype||v118.size!==4||v118.buffer!==g115||v118.normalized!==false||v118.offset!==0||v118.stride!==0){
  v1.bindBuffer(34962,g115.buffer);
  v1.vertexAttribPointer(v117,4,g115.dtype,false,0,0);
  v118.type=g115.dtype;
  v118.size=4;
  v118.buffer=g115;
  v118.normalized=false;
  v118.offset=0;
  v118.stride=0;
  }
  v121=g120.location;
  v122=v10[v121];
  if(!v122.buffer){
  v1.enableVertexAttribArray(v121);
  }
  if(v122.type!==g119.dtype||v122.size!==4||v122.buffer!==g119||v122.normalized!==false||v122.offset!==0||v122.stride!==0){
  v1.bindBuffer(34962,g119.buffer);
  v1.vertexAttribPointer(v121,4,g119.dtype,false,0,0);
  v122.type=g119.dtype;
  v122.size=4;
  v122.buffer=g119;
  v122.normalized=false;
  v122.offset=0;
  v122.stride=0;
  }
  v125=g124.location;
  v126=v10[v125];
  if(!v126.buffer){
  v1.enableVertexAttribArray(v125);
  }
  if(v126.type!==g123.dtype||v126.size!==4||v126.buffer!==g123||v126.normalized!==false||v126.offset!==0||v126.stride!==0){
  v1.bindBuffer(34962,g123.buffer);
  v1.vertexAttribPointer(v125,4,g123.dtype,false,0,0);
  v126.type=g123.dtype;
  v126.size=4;
  v126.buffer=g123;
  v126.normalized=false;
  v126.offset=0;
  v126.stride=0;
  }
  v129=g128.location;
  v130=v10[v129];
  if(!v130.buffer){
  v1.enableVertexAttribArray(v129);
  }
  if(v130.type!==g127.dtype||v130.size!==4||v130.buffer!==g127||v130.normalized!==false||v130.offset!==0||v130.stride!==0){
  v1.bindBuffer(34962,g127.buffer);
  v1.vertexAttribPointer(v129,4,g127.dtype,false,0,0);
  v130.type=g127.dtype;
  v130.size=4;
  v130.buffer=g127;
  v130.normalized=false;
  v130.offset=0;
  v130.stride=0;
  }
  v133=g132.location;
  v134=v10[v133];
  if(!v134.buffer){
  v1.enableVertexAttribArray(v133);
  }
  if(v134.type!==g131.dtype||v134.size!==4||v134.buffer!==g131||v134.normalized!==false||v134.offset!==0||v134.stride!==0){
  v1.bindBuffer(34962,g131.buffer);
  v1.vertexAttribPointer(v133,4,g131.dtype,false,0,0);
  v134.type=g131.dtype;
  v134.size=4;
  v134.buffer=g131;
  v134.normalized=false;
  v134.offset=0;
  v134.stride=0;
  }
  v137=g136.location;
  v138=v10[v137];
  if(!v138.buffer){
  v1.enableVertexAttribArray(v137);
  }
  if(v138.type!==g135.dtype||v138.size!==4||v138.buffer!==g135||v138.normalized!==false||v138.offset!==0||v138.stride!==0){
  v1.bindBuffer(34962,g135.buffer);
  v1.vertexAttribPointer(v137,4,g135.dtype,false,0,0);
  v138.type=g135.dtype;
  v138.size=4;
  v138.buffer=g135;
  v138.normalized=false;
  v138.offset=0;
  v138.stride=0;
  }
  v141=g140.location;
  v142=v10[v141];
  if(!v142.buffer){
  v1.enableVertexAttribArray(v141);
  }
  if(v142.type!==g139.dtype||v142.size!==4||v142.buffer!==g139||v142.normalized!==false||v142.offset!==0||v142.stride!==0){
  v1.bindBuffer(34962,g139.buffer);
  v1.vertexAttribPointer(v141,4,g139.dtype,false,0,0);
  v142.type=g139.dtype;
  v142.size=4;
  v142.buffer=g139;
  v142.normalized=false;
  v142.offset=0;
  v142.stride=0;
  }
  v145=g144.location;
  v146=v10[v145];
  if(!v146.buffer){
  v1.enableVertexAttribArray(v145);
  }
  if(v146.type!==g143.dtype||v146.size!==4||v146.buffer!==g143||v146.normalized!==false||v146.offset!==0||v146.stride!==0){
  v1.bindBuffer(34962,g143.buffer);
  v1.vertexAttribPointer(v145,4,g143.dtype,false,0,0);
  v146.type=g143.dtype;
  v146.size=4;
  v146.buffer=g143;
  v146.normalized=false;
  v146.offset=0;
  v146.stride=0;
  }
  v149=g148.location;
  v150=v10[v149];
  if(!v150.buffer){
  v1.enableVertexAttribArray(v149);
  }
  if(v150.type!==g147.dtype||v150.size!==4||v150.buffer!==g147||v150.normalized!==false||v150.offset!==0||v150.stride!==0){
  v1.bindBuffer(34962,g147.buffer);
  v1.vertexAttribPointer(v149,4,g147.dtype,false,0,0);
  v150.type=g147.dtype;
  v150.size=4;
  v150.buffer=g147;
  v150.normalized=false;
  v150.offset=0;
  v150.stride=0;
  }
  v153=g152.location;
  v154=v10[v153];
  if(!v154.buffer){
  v1.enableVertexAttribArray(v153);
  }
  if(v154.type!==g151.dtype||v154.size!==4||v154.buffer!==g151||v154.normalized!==false||v154.offset!==0||v154.stride!==0){
  v1.bindBuffer(34962,g151.buffer);
  v1.vertexAttribPointer(v153,4,g151.dtype,false,0,0);
  v154.type=g151.dtype;
  v154.size=4;
  v154.buffer=g151;
  v154.normalized=false;
  v154.offset=0;
  v154.stride=0;
  }
  v157=g156.location;
  v158=v10[v157];
  if(!v158.buffer){
  v1.enableVertexAttribArray(v157);
  }
  if(v158.type!==g155.dtype||v158.size!==4||v158.buffer!==g155||v158.normalized!==false||v158.offset!==0||v158.stride!==0){
  v1.bindBuffer(34962,g155.buffer);
  v1.vertexAttribPointer(v157,4,g155.dtype,false,0,0);
  v158.type=g155.dtype;
  v158.size=4;
  v158.buffer=g155;
  v158.normalized=false;
  v158.offset=0;
  v158.stride=0;
  }
  v161=g160.location;
  v162=v10[v161];
  if(!v162.buffer){
  v1.enableVertexAttribArray(v161);
  }
  if(v162.type!==g159.dtype||v162.size!==4||v162.buffer!==g159||v162.normalized!==false||v162.offset!==0||v162.stride!==0){
  v1.bindBuffer(34962,g159.buffer);
  v1.vertexAttribPointer(v161,4,g159.dtype,false,0,0);
  v162.type=g159.dtype;
  v162.size=4;
  v162.buffer=g159;
  v162.normalized=false;
  v162.offset=0;
  v162.stride=0;
  }
  v165=g164.location;
  v166=v10[v165];
  if(!v166.buffer){
  v1.enableVertexAttribArray(v165);
  }
  if(v166.type!==g163.dtype||v166.size!==4||v166.buffer!==g163||v166.normalized!==false||v166.offset!==0||v166.stride!==0){
  v1.bindBuffer(34962,g163.buffer);
  v1.vertexAttribPointer(v165,4,g163.dtype,false,0,0);
  v166.type=g163.dtype;
  v166.size=4;
  v166.buffer=g163;
  v166.normalized=false;
  v166.offset=0;
  v166.stride=0;
  }
  v168=a0["contextColor"];
  if(!(v17(v168)&&v168.length===4))g18.commandRaise(g169,g19);
  v170=v168[0];
  v171=v168[1];
  v172=v168[2];
  v173=v168[3];
  v1.uniform4f(g167.location,v170,v171,v172,v173);
  v175=a0["dim0A"];
  if(!(v17(v175)&&v175.length===16))g18.commandRaise(g176,g19);
  v1.uniformMatrix4fv(g174.location,false,(Array.isArray(v175)||v175 instanceof Float32Array)?v175:(v177[0]=v175[0],v177[1]=v175[1],v177[2]=v175[2],v177[3]=v175[3],v177[4]=v175[4],v177[5]=v175[5],v177[6]=v175[6],v177[7]=v175[7],v177[8]=v175[8],v177[9]=v175[9],v177[10]=v175[10],v177[11]=v175[11],v177[12]=v175[12],v177[13]=v175[13],v177[14]=v175[14],v177[15]=v175[15],v177));
  v179=a0["dim0B"];
  if(!(v17(v179)&&v179.length===16))g18.commandRaise(g180,g19);
  v1.uniformMatrix4fv(g178.location,false,(Array.isArray(v179)||v179 instanceof Float32Array)?v179:(v181[0]=v179[0],v181[1]=v179[1],v181[2]=v179[2],v181[3]=v179[3],v181[4]=v179[4],v181[5]=v179[5],v181[6]=v179[6],v181[7]=v179[7],v181[8]=v179[8],v181[9]=v179[9],v181[10]=v179[10],v181[11]=v179[11],v181[12]=v179[12],v181[13]=v179[13],v181[14]=v179[14],v181[15]=v179[15],v181));
  v183=a0["dim0C"];
  if(!(v17(v183)&&v183.length===16))g18.commandRaise(g184,g19);
  v1.uniformMatrix4fv(g182.location,false,(Array.isArray(v183)||v183 instanceof Float32Array)?v183:(v185[0]=v183[0],v185[1]=v183[1],v185[2]=v183[2],v185[3]=v183[3],v185[4]=v183[4],v185[5]=v183[5],v185[6]=v183[6],v185[7]=v183[7],v185[8]=v183[8],v185[9]=v183[9],v185[10]=v183[10],v185[11]=v183[11],v185[12]=v183[12],v185[13]=v183[13],v185[14]=v183[14],v185[15]=v183[15],v185));
  v187=a0["dim0D"];
  if(!(v17(v187)&&v187.length===16))g18.commandRaise(g188,g19);
  v1.uniformMatrix4fv(g186.location,false,(Array.isArray(v187)||v187 instanceof Float32Array)?v187:(v189[0]=v187[0],v189[1]=v187[1],v189[2]=v187[2],v189[3]=v187[3],v189[4]=v187[4],v189[5]=v187[5],v189[6]=v187[6],v189[7]=v187[7],v189[8]=v187[8],v189[9]=v187[9],v189[10]=v187[10],v189[11]=v187[11],v189[12]=v187[12],v189[13]=v187[13],v189[14]=v187[14],v189[15]=v187[15],v189));
  v191=a0["dim1A"];
  if(!(v17(v191)&&v191.length===16))g18.commandRaise(g192,g19);
  v1.uniformMatrix4fv(g190.location,false,(Array.isArray(v191)||v191 instanceof Float32Array)?v191:(v193[0]=v191[0],v193[1]=v191[1],v193[2]=v191[2],v193[3]=v191[3],v193[4]=v191[4],v193[5]=v191[5],v193[6]=v191[6],v193[7]=v191[7],v193[8]=v191[8],v193[9]=v191[9],v193[10]=v191[10],v193[11]=v191[11],v193[12]=v191[12],v193[13]=v191[13],v193[14]=v191[14],v193[15]=v191[15],v193));
  v195=a0["dim1B"];
  if(!(v17(v195)&&v195.length===16))g18.commandRaise(g196,g19);
  v1.uniformMatrix4fv(g194.location,false,(Array.isArray(v195)||v195 instanceof Float32Array)?v195:(v197[0]=v195[0],v197[1]=v195[1],v197[2]=v195[2],v197[3]=v195[3],v197[4]=v195[4],v197[5]=v195[5],v197[6]=v195[6],v197[7]=v195[7],v197[8]=v195[8],v197[9]=v195[9],v197[10]=v195[10],v197[11]=v195[11],v197[12]=v195[12],v197[13]=v195[13],v197[14]=v195[14],v197[15]=v195[15],v197));
  v199=a0["dim1C"];
  if(!(v17(v199)&&v199.length===16))g18.commandRaise(g200,g19);
  v1.uniformMatrix4fv(g198.location,false,(Array.isArray(v199)||v199 instanceof Float32Array)?v199:(v201[0]=v199[0],v201[1]=v199[1],v201[2]=v199[2],v201[3]=v199[3],v201[4]=v199[4],v201[5]=v199[5],v201[6]=v199[6],v201[7]=v199[7],v201[8]=v199[8],v201[9]=v199[9],v201[10]=v199[10],v201[11]=v199[11],v201[12]=v199[12],v201[13]=v199[13],v201[14]=v199[14],v201[15]=v199[15],v201));
  v203=a0["dim1D"];
  if(!(v17(v203)&&v203.length===16))g18.commandRaise(g204,g19);
  v1.uniformMatrix4fv(g202.location,false,(Array.isArray(v203)||v203 instanceof Float32Array)?v203:(v205[0]=v203[0],v205[1]=v203[1],v205[2]=v203[2],v205[3]=v203[3],v205[4]=v203[4],v205[5]=v203[5],v205[6]=v203[6],v205[7]=v203[7],v205[8]=v203[8],v205[9]=v203[9],v205[10]=v203[10],v205[11]=v203[11],v205[12]=v203[12],v205[13]=v203[13],v205[14]=v203[14],v205[15]=v203[15],v205));
  v207=a0["drwLayer"];
  if(!(typeof v207==="number"))g18.commandRaise(g208,g19);
  v1.uniform1f(g206.location,v207);
  v210=a0["hiA"];
  if(!(v17(v210)&&v210.length===16))g18.commandRaise(g211,g19);
  v1.uniformMatrix4fv(g209.location,false,(Array.isArray(v210)||v210 instanceof Float32Array)?v210:(v212[0]=v210[0],v212[1]=v210[1],v212[2]=v210[2],v212[3]=v210[3],v212[4]=v210[4],v212[5]=v210[5],v212[6]=v210[6],v212[7]=v210[7],v212[8]=v210[8],v212[9]=v210[9],v212[10]=v210[10],v212[11]=v210[11],v212[12]=v210[12],v212[13]=v210[13],v212[14]=v210[14],v212[15]=v210[15],v212));
  v214=a0["hiB"];
  if(!(v17(v214)&&v214.length===16))g18.commandRaise(g215,g19);
  v1.uniformMatrix4fv(g213.location,false,(Array.isArray(v214)||v214 instanceof Float32Array)?v214:(v216[0]=v214[0],v216[1]=v214[1],v216[2]=v214[2],v216[3]=v214[3],v216[4]=v214[4],v216[5]=v214[5],v216[6]=v214[6],v216[7]=v214[7],v216[8]=v214[8],v216[9]=v214[9],v216[10]=v214[10],v216[11]=v214[11],v216[12]=v214[12],v216[13]=v214[13],v216[14]=v214[14],v216[15]=v214[15],v216));
  v218=a0["hiC"];
  if(!(v17(v218)&&v218.length===16))g18.commandRaise(g219,g19);
  v1.uniformMatrix4fv(g217.location,false,(Array.isArray(v218)||v218 instanceof Float32Array)?v218:(v220[0]=v218[0],v220[1]=v218[1],v220[2]=v218[2],v220[3]=v218[3],v220[4]=v218[4],v220[5]=v218[5],v220[6]=v218[6],v220[7]=v218[7],v220[8]=v218[8],v220[9]=v218[9],v220[10]=v218[10],v220[11]=v218[11],v220[12]=v218[12],v220[13]=v218[13],v220[14]=v218[14],v220[15]=v218[15],v220));
  v222=a0["hiD"];
  if(!(v17(v222)&&v222.length===16))g18.commandRaise(g223,g19);
  v1.uniformMatrix4fv(g221.location,false,(Array.isArray(v222)||v222 instanceof Float32Array)?v222:(v224[0]=v222[0],v224[1]=v222[1],v224[2]=v222[2],v224[3]=v222[3],v224[4]=v222[4],v224[5]=v222[5],v224[6]=v222[6],v224[7]=v222[7],v224[8]=v222[8],v224[9]=v222[9],v224[10]=v222[10],v224[11]=v222[11],v224[12]=v222[12],v224[13]=v222[13],v224[14]=v222[14],v224[15]=v222[15],v224));
  v226=a0["loA"];
  if(!(v17(v226)&&v226.length===16))g18.commandRaise(g227,g19);
  v1.uniformMatrix4fv(g225.location,false,(Array.isArray(v226)||v226 instanceof Float32Array)?v226:(v228[0]=v226[0],v228[1]=v226[1],v228[2]=v226[2],v228[3]=v226[3],v228[4]=v226[4],v228[5]=v226[5],v228[6]=v226[6],v228[7]=v226[7],v228[8]=v226[8],v228[9]=v226[9],v228[10]=v226[10],v228[11]=v226[11],v228[12]=v226[12],v228[13]=v226[13],v228[14]=v226[14],v228[15]=v226[15],v228));
  v230=a0["loB"];
  if(!(v17(v230)&&v230.length===16))g18.commandRaise(g231,g19);
  v1.uniformMatrix4fv(g229.location,false,(Array.isArray(v230)||v230 instanceof Float32Array)?v230:(v232[0]=v230[0],v232[1]=v230[1],v232[2]=v230[2],v232[3]=v230[3],v232[4]=v230[4],v232[5]=v230[5],v232[6]=v230[6],v232[7]=v230[7],v232[8]=v230[8],v232[9]=v230[9],v232[10]=v230[10],v232[11]=v230[11],v232[12]=v230[12],v232[13]=v230[13],v232[14]=v230[14],v232[15]=v230[15],v232));
  v234=a0["loC"];
  if(!(v17(v234)&&v234.length===16))g18.commandRaise(g235,g19);
  v1.uniformMatrix4fv(g233.location,false,(Array.isArray(v234)||v234 instanceof Float32Array)?v234:(v236[0]=v234[0],v236[1]=v234[1],v236[2]=v234[2],v236[3]=v234[3],v236[4]=v234[4],v236[5]=v234[5],v236[6]=v234[6],v236[7]=v234[7],v236[8]=v234[8],v236[9]=v234[9],v236[10]=v234[10],v236[11]=v234[11],v236[12]=v234[12],v236[13]=v234[13],v236[14]=v234[14],v236[15]=v234[15],v236));
  v238=a0["loD"];
  if(!(v17(v238)&&v238.length===16))g18.commandRaise(g239,g19);
  v1.uniformMatrix4fv(g237.location,false,(Array.isArray(v238)||v238 instanceof Float32Array)?v238:(v240[0]=v238[0],v240[1]=v238[1],v240[2]=v238[2],v240[3]=v238[3],v240[4]=v238[4],v240[5]=v238[5],v240[6]=v238[6],v240[7]=v238[7],v240[8]=v238[8],v240[9]=v238[9],v240[10]=v238[10],v240[11]=v238[11],v240[12]=v238[12],v240[13]=v238[13],v240[14]=v238[14],v240[15]=v238[15],v240));
  v242=a0["maskHeight"];
  if(!(typeof v242==="number"))g18.commandRaise(g243,g19);
  v1.uniform1f(g241.location,v242);
  v245=a0["maskTexture"];
  if(v245&&v245._reglType==="framebuffer"){
  v245=v245.color[0];
  }
  if(!(typeof v245==="function"&&v245._reglType==="texture2d"))g18.commandRaise(g246,g19);
  v247=v245._texture;
  v1.uniform1i(g244.location,v247.bind());
  v1.uniform1i(g248.location,g249.bind());
  v251=a0["resolution"];
  if(!(v17(v251)&&v251.length===2))g18.commandRaise(g252,g19);
  v253=v251[0];
  v254=v251[1];
  v1.uniform2f(g250.location,v253,v254);
  v256=a0["viewBoxPos"];
  if(!(v17(v256)&&v256.length===2))g18.commandRaise(g257,g19);
  v258=v256[0];
  v259=v256[1];
  v1.uniform2f(g255.location,v258,v259);
  v261=a0["viewBoxSize"];
  if(!(v17(v261)&&v261.length===2))g18.commandRaise(g262,g19);
  v263=v261[0];
  v264=v261[1];
  v1.uniform2f(g260.location,v263,v264);
  v265=v6.elements;
  if(v265){
  v1.bindBuffer(34963,v265.buffer.buffer);
  }
  else if(v11.currentVAO){
  v265=v7.getElements(v11.currentVAO.elements);
  if(v265)v1.bindBuffer(34963,v265.buffer.buffer);
  }
  v266=a0["offset"];
  if(!(v266>=0))g18.commandRaise(g267,g19);
  v268=a0["count"];
  if(!(typeof v268==="number"&&v268>=0&&v268===(v268|0)))g18.commandRaise(g269,g19);
  if(v268){
  if(v265){
  v1.drawElements(1,v268,v265.type,v266<<((v265.type-5121)>>1));
  }
  else{
  v1.drawArrays(1,v266,v268);
  }
  v5.dirty=true;
  v11.setVAO(null);
  v2.viewportWidth=v90;
  v2.viewportHeight=v91;
  v5.profile=v101;
  v247.unbind();
  g249.unbind();
  }
  }
  ,"scope":function(a0,a1,a2){
  var v270,v271,v272,v273,v274,v275,v276,v277,v278,v279,v280,v281,v282,v283,v284,v285,v286,v287,v288,v289,v290,v291,v292,v293,v294,v295,v296,v297,v298,v299,v300,v301,v302,v303,v304,v305,v306,v307,v308,v309,v310,v311,v312,v313,v314,v315,v316,v317,v318,v319,v320,v321,v322,v324,v325,v326,v327,v328,v329,v330,v331,v332,v333,v334,v335,v336,v337,v338,v339,v340,v341,v342,v343,v344,v345,v346,v347,v348,v349,v350,v351,v352,v353,v354,v355,v356,v357,v358,v359,v360,v361,v362,v363,v364,v365,v366,v367,v368,v369,v370,v372,v373,v374,v375,v376,v377,v378,v379,v380,v381,v382,v383,v385,v386,v387,v388,v389,v390,v391,v392,v393,v394,v395,v396,v398,v399,v400,v401,v402,v403,v404,v405,v406,v407,v408,v409,v411,v412,v413,v414,v415,v416,v417,v418,v419,v420,v421,v422,v424,v425,v426,v427,v428,v429,v430,v431,v432,v433,v434,v435,v437,v438,v439,v440,v441,v442,v443,v444,v445,v446,v447,v448,v450,v451,v452,v453,v454,v455,v456,v457,v458,v459,v460,v461,v463,v464,v465,v466,v467,v468,v469,v470,v471,v472,v473,v474,v476,v477,v478,v479,v480,v481,v482,v483,v484,v485,v486,v487,v489,v490,v491,v492,v493,v494,v495,v496,v497,v498,v499,v500,v502,v503,v504,v505,v506,v507,v508,v509,v510,v511,v512,v513,v515,v516,v517,v518,v519,v520,v521,v522,v523,v524,v525,v526,v528,v529,v530,v531,v532,v533,v534,v535,v536,v537,v538,v539,v541,v542,v543,v544,v545,v546,v547,v548,v549,v550,v551,v552,v554,v555,v556,v557,v558,v559,v560,v561,v562,v563,v564,v565,v567,v568,v569,v570,v571,v572,v573,v574,v575,v576,v577,v578,v579,v580;
  v270=a0["viewportX"];
  v53.x=v270;
  v271=a0["viewportY"];
  v53.y=v271;
  v272=a0["viewportWidth"];
  v53.width=v272;
  v273=a0["viewportHeight"];
  v53.height=v273;
  if(!(v53&&typeof v53==="object"))g18.commandRaise(g85,g19);
  v274=v53.x|0;
  v275=v53.y|0;
  v276="width" in v53?v53.width|0:(v2.framebufferWidth-v274);
  v277="height" in v53?v53.height|0:(v2.framebufferHeight-v275);
  if(!(v276>=0&&v277>=0))g18.commandRaise(g85,g19);
  v278=v2.viewportWidth;
  v2.viewportWidth=v276;
  v279=v2.viewportHeight;
  v2.viewportHeight=v277;
  v280=v42[0];
  v42[0]=_gs[18];
  v281=v42[1];
  v42[1]=_gs[19];
  v282=v42[2];
  v42[2]=_gs[20];
  v283=v42[3];
  v42[3]=_gs[21];
  v284=v20[0];
  v20[0]=_gs[22];
  v285=v20[1];
  v20[1]=_gs[23];
  v286=v20[2];
  v20[2]=_gs[24];
  v287=v20[3];
  v20[3]=_gs[25];
  v288=v4.blend_enable;
  v4.blend_enable=_gs[26];
  v289=v22[0];
  v22[0]=_gs[27];
  v290=v22[1];
  v22[1]=_gs[28];
  v291=v24[0];
  v24[0]=_gs[29];
  v292=v24[1];
  v24[1]=_gs[30];
  v293=v24[2];
  v24[2]=_gs[31];
  v294=v24[3];
  v24[3]=_gs[32];
  v295=v4.cull_enable;
  v4.cull_enable=_gs[33];
  v296=v4.cull_face;
  v4.cull_face=_gs[34];
  v297=v4.depth_enable;
  v4.depth_enable=_gs[35];
  v298=v4.depth_func;
  v4.depth_func=_gs[36];
  v299=v4.depth_mask;
  v4.depth_mask=_gs[37];
  v300=v26[0];
  v26[0]=_gs[38];
  v301=v26[1];
  v26[1]=_gs[39];
  v302=v4.dither;
  v4.dither=_gs[40];
  v303=v4.lineWidth;
  v4.lineWidth=_gs[41];
  v304=a0["scissorX"];
  v54.x=v304;
  v305=a0["scissorY"];
  v54.y=v305;
  v306=a0["scissorWidth"];
  v54.width=v306;
  v307=a0["scissorHeight"];
  v54.height=v307;
  if(!(v54&&typeof v54==="object"))g18.commandRaise(g96,g19);
  v308=v54.x|0;
  v309=v54.y|0;
  v310="width" in v54?v54.width|0:(v2.framebufferWidth-v308);
  v311="height" in v54?v54.height|0:(v2.framebufferHeight-v309);
  if(!(v310>=0&&v311>=0))g18.commandRaise(g96,g19);
  v312=v40[0];
  v40[0]=_gs[42];
  v313=v40[1];
  v40[1]=_gs[43];
  v314=v40[2];
  v40[2]=_gs[44];
  v315=v40[3];
  v40[3]=_gs[45];
  v316=v4.scissor_enable;
  v4.scissor_enable=_gs[46];
  v317=v5.profile;
  v5.profile=false;
  v318=a0["offset"];
  if(!(v318>=0))g18.commandRaise(g267,g19);
  v319=v6.offset;
  v6.offset=_gs[47];
  v320=a0["count"];
  if(!(typeof v320==="number"&&v320>=0&&v320===(v320|0)))g18.commandRaise(g269,g19);
  v321=v6.count;
  v6.count=_gs[48];
  v322=v6.primitive;
  v6.primitive=_gs[49];
  v324=v12[_gs[50]];
  v12[_gs[50]]=g323;
  v325=a0["resolution"];
  v326=v12[_gs[51]];
  v12[_gs[51]]=v325;
  v327=a0["viewBoxPos"];
  v328=v12[_gs[52]];
  v12[_gs[52]]=v327;
  v329=a0["viewBoxSize"];
  v330=v12[_gs[53]];
  v12[_gs[53]]=v329;
  v331=a0["dim0A"];
  v332=v12[_gs[54]];
  v12[_gs[54]]=v331;
  v333=a0["dim1A"];
  v334=v12[_gs[55]];
  v12[_gs[55]]=v333;
  v335=a0["dim0B"];
  v336=v12[_gs[56]];
  v12[_gs[56]]=v335;
  v337=a0["dim1B"];
  v338=v12[_gs[57]];
  v12[_gs[57]]=v337;
  v339=a0["dim0C"];
  v340=v12[_gs[58]];
  v12[_gs[58]]=v339;
  v341=a0["dim1C"];
  v342=v12[_gs[59]];
  v12[_gs[59]]=v341;
  v343=a0["dim0D"];
  v344=v12[_gs[60]];
  v12[_gs[60]]=v343;
  v345=a0["dim1D"];
  v346=v12[_gs[61]];
  v12[_gs[61]]=v345;
  v347=a0["loA"];
  v348=v12[_gs[62]];
  v12[_gs[62]]=v347;
  v349=a0["hiA"];
  v350=v12[_gs[63]];
  v12[_gs[63]]=v349;
  v351=a0["loB"];
  v352=v12[_gs[64]];
  v12[_gs[64]]=v351;
  v353=a0["hiB"];
  v354=v12[_gs[65]];
  v12[_gs[65]]=v353;
  v355=a0["loC"];
  v356=v12[_gs[66]];
  v12[_gs[66]]=v355;
  v357=a0["hiC"];
  v358=v12[_gs[67]];
  v12[_gs[67]]=v357;
  v359=a0["loD"];
  v360=v12[_gs[68]];
  v12[_gs[68]]=v359;
  v361=a0["hiD"];
  v362=v12[_gs[69]];
  v12[_gs[69]]=v361;
  v363=a0["contextColor"];
  v364=v12[_gs[70]];
  v12[_gs[70]]=v363;
  v365=a0["maskTexture"];
  v366=v12[_gs[71]];
  v12[_gs[71]]=v365;
  v367=a0["drwLayer"];
  v368=v12[_gs[72]];
  v12[_gs[72]]=v367;
  v369=a0["maskHeight"];
  v370=v12[_gs[73]];
  v12[_gs[73]]=v369;
  v372=g371.state;
  g371.state=1;
  v373=g371.x;
  g371.x=0;
  v374=g371.y;
  g371.y=0;
  v375=g371.z;
  g371.z=0;
  v376=g371.w;
  g371.w=0;
  v377=g371.buffer;
  g371.buffer=g107;
  v378=g371.size;
  g371.size=0;
  v379=g371.normalized;
  g371.normalized=false;
  v380=g371.type;
  g371.type=g107.dtype;
  v381=g371.offset;
  g371.offset=0;
  v382=g371.stride;
  g371.stride=0;
  v383=g371.divisor;
  g371.divisor=0;
  v385=g384.state;
  g384.state=1;
  v386=g384.x;
  g384.x=0;
  v387=g384.y;
  g384.y=0;
  v388=g384.z;
  g384.z=0;
  v389=g384.w;
  g384.w=0;
  v390=g384.buffer;
  g384.buffer=g111;
  v391=g384.size;
  g384.size=0;
  v392=g384.normalized;
  g384.normalized=false;
  v393=g384.type;
  g384.type=g111.dtype;
  v394=g384.offset;
  g384.offset=0;
  v395=g384.stride;
  g384.stride=0;
  v396=g384.divisor;
  g384.divisor=0;
  v398=g397.state;
  g397.state=1;
  v399=g397.x;
  g397.x=0;
  v400=g397.y;
  g397.y=0;
  v401=g397.z;
  g397.z=0;
  v402=g397.w;
  g397.w=0;
  v403=g397.buffer;
  g397.buffer=g115;
  v404=g397.size;
  g397.size=0;
  v405=g397.normalized;
  g397.normalized=false;
  v406=g397.type;
  g397.type=g115.dtype;
  v407=g397.offset;
  g397.offset=0;
  v408=g397.stride;
  g397.stride=0;
  v409=g397.divisor;
  g397.divisor=0;
  v411=g410.state;
  g410.state=1;
  v412=g410.x;
  g410.x=0;
  v413=g410.y;
  g410.y=0;
  v414=g410.z;
  g410.z=0;
  v415=g410.w;
  g410.w=0;
  v416=g410.buffer;
  g410.buffer=g119;
  v417=g410.size;
  g410.size=0;
  v418=g410.normalized;
  g410.normalized=false;
  v419=g410.type;
  g410.type=g119.dtype;
  v420=g410.offset;
  g410.offset=0;
  v421=g410.stride;
  g410.stride=0;
  v422=g410.divisor;
  g410.divisor=0;
  v424=g423.state;
  g423.state=1;
  v425=g423.x;
  g423.x=0;
  v426=g423.y;
  g423.y=0;
  v427=g423.z;
  g423.z=0;
  v428=g423.w;
  g423.w=0;
  v429=g423.buffer;
  g423.buffer=g123;
  v430=g423.size;
  g423.size=0;
  v431=g423.normalized;
  g423.normalized=false;
  v432=g423.type;
  g423.type=g123.dtype;
  v433=g423.offset;
  g423.offset=0;
  v434=g423.stride;
  g423.stride=0;
  v435=g423.divisor;
  g423.divisor=0;
  v437=g436.state;
  g436.state=1;
  v438=g436.x;
  g436.x=0;
  v439=g436.y;
  g436.y=0;
  v440=g436.z;
  g436.z=0;
  v441=g436.w;
  g436.w=0;
  v442=g436.buffer;
  g436.buffer=g127;
  v443=g436.size;
  g436.size=0;
  v444=g436.normalized;
  g436.normalized=false;
  v445=g436.type;
  g436.type=g127.dtype;
  v446=g436.offset;
  g436.offset=0;
  v447=g436.stride;
  g436.stride=0;
  v448=g436.divisor;
  g436.divisor=0;
  v450=g449.state;
  g449.state=1;
  v451=g449.x;
  g449.x=0;
  v452=g449.y;
  g449.y=0;
  v453=g449.z;
  g449.z=0;
  v454=g449.w;
  g449.w=0;
  v455=g449.buffer;
  g449.buffer=g131;
  v456=g449.size;
  g449.size=0;
  v457=g449.normalized;
  g449.normalized=false;
  v458=g449.type;
  g449.type=g131.dtype;
  v459=g449.offset;
  g449.offset=0;
  v460=g449.stride;
  g449.stride=0;
  v461=g449.divisor;
  g449.divisor=0;
  v463=g462.state;
  g462.state=1;
  v464=g462.x;
  g462.x=0;
  v465=g462.y;
  g462.y=0;
  v466=g462.z;
  g462.z=0;
  v467=g462.w;
  g462.w=0;
  v468=g462.buffer;
  g462.buffer=g135;
  v469=g462.size;
  g462.size=0;
  v470=g462.normalized;
  g462.normalized=false;
  v471=g462.type;
  g462.type=g135.dtype;
  v472=g462.offset;
  g462.offset=0;
  v473=g462.stride;
  g462.stride=0;
  v474=g462.divisor;
  g462.divisor=0;
  v476=g475.state;
  g475.state=1;
  v477=g475.x;
  g475.x=0;
  v478=g475.y;
  g475.y=0;
  v479=g475.z;
  g475.z=0;
  v480=g475.w;
  g475.w=0;
  v481=g475.buffer;
  g475.buffer=g139;
  v482=g475.size;
  g475.size=0;
  v483=g475.normalized;
  g475.normalized=false;
  v484=g475.type;
  g475.type=g139.dtype;
  v485=g475.offset;
  g475.offset=0;
  v486=g475.stride;
  g475.stride=0;
  v487=g475.divisor;
  g475.divisor=0;
  v489=g488.state;
  g488.state=1;
  v490=g488.x;
  g488.x=0;
  v491=g488.y;
  g488.y=0;
  v492=g488.z;
  g488.z=0;
  v493=g488.w;
  g488.w=0;
  v494=g488.buffer;
  g488.buffer=g143;
  v495=g488.size;
  g488.size=0;
  v496=g488.normalized;
  g488.normalized=false;
  v497=g488.type;
  g488.type=g143.dtype;
  v498=g488.offset;
  g488.offset=0;
  v499=g488.stride;
  g488.stride=0;
  v500=g488.divisor;
  g488.divisor=0;
  v502=g501.state;
  g501.state=1;
  v503=g501.x;
  g501.x=0;
  v504=g501.y;
  g501.y=0;
  v505=g501.z;
  g501.z=0;
  v506=g501.w;
  g501.w=0;
  v507=g501.buffer;
  g501.buffer=g147;
  v508=g501.size;
  g501.size=0;
  v509=g501.normalized;
  g501.normalized=false;
  v510=g501.type;
  g501.type=g147.dtype;
  v511=g501.offset;
  g501.offset=0;
  v512=g501.stride;
  g501.stride=0;
  v513=g501.divisor;
  g501.divisor=0;
  v515=g514.state;
  g514.state=1;
  v516=g514.x;
  g514.x=0;
  v517=g514.y;
  g514.y=0;
  v518=g514.z;
  g514.z=0;
  v519=g514.w;
  g514.w=0;
  v520=g514.buffer;
  g514.buffer=g151;
  v521=g514.size;
  g514.size=0;
  v522=g514.normalized;
  g514.normalized=false;
  v523=g514.type;
  g514.type=g151.dtype;
  v524=g514.offset;
  g514.offset=0;
  v525=g514.stride;
  g514.stride=0;
  v526=g514.divisor;
  g514.divisor=0;
  v528=g527.state;
  g527.state=1;
  v529=g527.x;
  g527.x=0;
  v530=g527.y;
  g527.y=0;
  v531=g527.z;
  g527.z=0;
  v532=g527.w;
  g527.w=0;
  v533=g527.buffer;
  g527.buffer=g155;
  v534=g527.size;
  g527.size=0;
  v535=g527.normalized;
  g527.normalized=false;
  v536=g527.type;
  g527.type=g155.dtype;
  v537=g527.offset;
  g527.offset=0;
  v538=g527.stride;
  g527.stride=0;
  v539=g527.divisor;
  g527.divisor=0;
  v541=g540.state;
  g540.state=1;
  v542=g540.x;
  g540.x=0;
  v543=g540.y;
  g540.y=0;
  v544=g540.z;
  g540.z=0;
  v545=g540.w;
  g540.w=0;
  v546=g540.buffer;
  g540.buffer=g159;
  v547=g540.size;
  g540.size=0;
  v548=g540.normalized;
  g540.normalized=false;
  v549=g540.type;
  g540.type=g159.dtype;
  v550=g540.offset;
  g540.offset=0;
  v551=g540.stride;
  g540.stride=0;
  v552=g540.divisor;
  g540.divisor=0;
  v554=g553.state;
  g553.state=1;
  v555=g553.x;
  g553.x=0;
  v556=g553.y;
  g553.y=0;
  v557=g553.z;
  g553.z=0;
  v558=g553.w;
  g553.w=0;
  v559=g553.buffer;
  g553.buffer=g163;
  v560=g553.size;
  g553.size=0;
  v561=g553.normalized;
  g553.normalized=false;
  v562=g553.type;
  g553.type=g163.dtype;
  v563=g553.offset;
  g553.offset=0;
  v564=g553.stride;
  g553.stride=0;
  v565=g553.divisor;
  g553.divisor=0;
  v567=g566.state;
  g566.state=1;
  v568=g566.x;
  g566.x=0;
  v569=g566.y;
  g566.y=0;
  v570=g566.z;
  g566.z=0;
  v571=g566.w;
  g566.w=0;
  v572=g566.buffer;
  g566.buffer=g103;
  v573=g566.size;
  g566.size=0;
  v574=g566.normalized;
  g566.normalized=false;
  v575=g566.type;
  g566.type=g103.dtype;
  v576=g566.offset;
  g566.offset=0;
  v577=g566.stride;
  g566.stride=0;
  v578=g566.divisor;
  g566.divisor=0;
  v579=v9.vert;
  v9.vert=_gs[74];
  v580=v9.frag;
  v9.frag=_gs[75];
  v5.dirty=true;
  a1(v2,a0,a2);
  v2.viewportWidth=v278;
  v2.viewportHeight=v279;
  v42[0]=v280;
  v42[1]=v281;
  v42[2]=v282;
  v42[3]=v283;
  v20[0]=v284;
  v20[1]=v285;
  v20[2]=v286;
  v20[3]=v287;
  v4.blend_enable=v288;
  v22[0]=v289;
  v22[1]=v290;
  v24[0]=v291;
  v24[1]=v292;
  v24[2]=v293;
  v24[3]=v294;
  v4.cull_enable=v295;
  v4.cull_face=v296;
  v4.depth_enable=v297;
  v4.depth_func=v298;
  v4.depth_mask=v299;
  v26[0]=v300;
  v26[1]=v301;
  v4.dither=v302;
  v4.lineWidth=v303;
  v40[0]=v312;
  v40[1]=v313;
  v40[2]=v314;
  v40[3]=v315;
  v4.scissor_enable=v316;
  v5.profile=v317;
  v6.offset=v319;
  v6.count=v321;
  v6.primitive=v322;
  v12[_gs[50]]=v324;
  v12[_gs[51]]=v326;
  v12[_gs[52]]=v328;
  v12[_gs[53]]=v330;
  v12[_gs[54]]=v332;
  v12[_gs[55]]=v334;
  v12[_gs[56]]=v336;
  v12[_gs[57]]=v338;
  v12[_gs[58]]=v340;
  v12[_gs[59]]=v342;
  v12[_gs[60]]=v344;
  v12[_gs[61]]=v346;
  v12[_gs[62]]=v348;
  v12[_gs[63]]=v350;
  v12[_gs[64]]=v352;
  v12[_gs[65]]=v354;
  v12[_gs[66]]=v356;
  v12[_gs[67]]=v358;
  v12[_gs[68]]=v360;
  v12[_gs[69]]=v362;
  v12[_gs[70]]=v364;
  v12[_gs[71]]=v366;
  v12[_gs[72]]=v368;
  v12[_gs[73]]=v370;
  g371.state=v372;
  g371.x=v373;
  g371.y=v374;
  g371.z=v375;
  g371.w=v376;
  g371.buffer=v377;
  g371.size=v378;
  g371.normalized=v379;
  g371.type=v380;
  g371.offset=v381;
  g371.stride=v382;
  g371.divisor=v383;
  g384.state=v385;
  g384.x=v386;
  g384.y=v387;
  g384.z=v388;
  g384.w=v389;
  g384.buffer=v390;
  g384.size=v391;
  g384.normalized=v392;
  g384.type=v393;
  g384.offset=v394;
  g384.stride=v395;
  g384.divisor=v396;
  g397.state=v398;
  g397.x=v399;
  g397.y=v400;
  g397.z=v401;
  g397.w=v402;
  g397.buffer=v403;
  g397.size=v404;
  g397.normalized=v405;
  g397.type=v406;
  g397.offset=v407;
  g397.stride=v408;
  g397.divisor=v409;
  g410.state=v411;
  g410.x=v412;
  g410.y=v413;
  g410.z=v414;
  g410.w=v415;
  g410.buffer=v416;
  g410.size=v417;
  g410.normalized=v418;
  g410.type=v419;
  g410.offset=v420;
  g410.stride=v421;
  g410.divisor=v422;
  g423.state=v424;
  g423.x=v425;
  g423.y=v426;
  g423.z=v427;
  g423.w=v428;
  g423.buffer=v429;
  g423.size=v430;
  g423.normalized=v431;
  g423.type=v432;
  g423.offset=v433;
  g423.stride=v434;
  g423.divisor=v435;
  g436.state=v437;
  g436.x=v438;
  g436.y=v439;
  g436.z=v440;
  g436.w=v441;
  g436.buffer=v442;
  g436.size=v443;
  g436.normalized=v444;
  g436.type=v445;
  g436.offset=v446;
  g436.stride=v447;
  g436.divisor=v448;
  g449.state=v450;
  g449.x=v451;
  g449.y=v452;
  g449.z=v453;
  g449.w=v454;
  g449.buffer=v455;
  g449.size=v456;
  g449.normalized=v457;
  g449.type=v458;
  g449.offset=v459;
  g449.stride=v460;
  g449.divisor=v461;
  g462.state=v463;
  g462.x=v464;
  g462.y=v465;
  g462.z=v466;
  g462.w=v467;
  g462.buffer=v468;
  g462.size=v469;
  g462.normalized=v470;
  g462.type=v471;
  g462.offset=v472;
  g462.stride=v473;
  g462.divisor=v474;
  g475.state=v476;
  g475.x=v477;
  g475.y=v478;
  g475.z=v479;
  g475.w=v480;
  g475.buffer=v481;
  g475.size=v482;
  g475.normalized=v483;
  g475.type=v484;
  g475.offset=v485;
  g475.stride=v486;
  g475.divisor=v487;
  g488.state=v489;
  g488.x=v490;
  g488.y=v491;
  g488.z=v492;
  g488.w=v493;
  g488.buffer=v494;
  g488.size=v495;
  g488.normalized=v496;
  g488.type=v497;
  g488.offset=v498;
  g488.stride=v499;
  g488.divisor=v500;
  g501.state=v502;
  g501.x=v503;
  g501.y=v504;
  g501.z=v505;
  g501.w=v506;
  g501.buffer=v507;
  g501.size=v508;
  g501.normalized=v509;
  g501.type=v510;
  g501.offset=v511;
  g501.stride=v512;
  g501.divisor=v513;
  g514.state=v515;
  g514.x=v516;
  g514.y=v517;
  g514.z=v518;
  g514.w=v519;
  g514.buffer=v520;
  g514.size=v521;
  g514.normalized=v522;
  g514.type=v523;
  g514.offset=v524;
  g514.stride=v525;
  g514.divisor=v526;
  g527.state=v528;
  g527.x=v529;
  g527.y=v530;
  g527.z=v531;
  g527.w=v532;
  g527.buffer=v533;
  g527.size=v534;
  g527.normalized=v535;
  g527.type=v536;
  g527.offset=v537;
  g527.stride=v538;
  g527.divisor=v539;
  g540.state=v541;
  g540.x=v542;
  g540.y=v543;
  g540.z=v544;
  g540.w=v545;
  g540.buffer=v546;
  g540.size=v547;
  g540.normalized=v548;
  g540.type=v549;
  g540.offset=v550;
  g540.stride=v551;
  g540.divisor=v552;
  g553.state=v554;
  g553.x=v555;
  g553.y=v556;
  g553.z=v557;
  g553.w=v558;
  g553.buffer=v559;
  g553.size=v560;
  g553.normalized=v561;
  g553.type=v562;
  g553.offset=v563;
  g553.stride=v564;
  g553.divisor=v565;
  g566.state=v567;
  g566.x=v568;
  g566.y=v569;
  g566.z=v570;
  g566.w=v571;
  g566.buffer=v572;
  g566.size=v573;
  g566.normalized=v574;
  g566.type=v575;
  g566.offset=v576;
  g566.stride=v577;
  g566.divisor=v578;
  v9.vert=v579;
  v9.frag=v580;
  v5.dirty=true;
  }
  ,"batch":function(a0,a1){
  var v581,v607,v608,v609;
  v581=v13.next;
  if(v581!==v13.cur){
  if(v581){
  v1.bindFramebuffer(36160,v581.framebuffer);
  }
  else{
  v1.bindFramebuffer(36160,null);
  }
  v13.cur=v581;
  }
  if(v5.dirty){
  var v582,v583,v584,v585,v586,v587,v588,v589,v590,v591,v592,v593,v594,v595,v596,v597,v598,v599,v600,v601,v602,v603,v604,v605,v606;
  v582=v28[0];
  v583=v28[1];
  v584=v28[2];
  v585=v28[3];
  if(v582!==v29[0]||v583!==v29[1]||v584!==v29[2]||v585!==v29[3]){
  v1.colorMask(v582,v583,v584,v585);
  v29[0]=v582;
  v29[1]=v583;
  v29[2]=v584;
  v29[3]=v585;
  }
  v586=v4.frontFace;
  if(v586!==v5.frontFace){
  v1.frontFace(v586);
  v5.frontFace=v586;
  }
  v587=v4.polygonOffset_enable;
  if(v587!==v5.polygonOffset_enable){
  if(v587){
  v1.enable(32823);
  }
  else{
  v1.disable(32823);
  }
  v5.polygonOffset_enable=v587;
  }
  v588=v30[0];
  v589=v30[1];
  if(v588!==v31[0]||v589!==v31[1]){
  v1.polygonOffset(v588,v589);
  v31[0]=v588;
  v31[1]=v589;
  }
  v590=v4.sample_alpha;
  if(v590!==v5.sample_alpha){
  if(v590){
  v1.enable(32926);
  }
  else{
  v1.disable(32926);
  }
  v5.sample_alpha=v590;
  }
  v591=v4.sample_enable;
  if(v591!==v5.sample_enable){
  if(v591){
  v1.enable(32928);
  }
  else{
  v1.disable(32928);
  }
  v5.sample_enable=v591;
  }
  v592=v32[0];
  v593=v32[1];
  if(v592!==v33[0]||v593!==v33[1]){
  v1.sampleCoverage(v592,v593);
  v33[0]=v592;
  v33[1]=v593;
  }
  v594=v4.stencil_enable;
  if(v594!==v5.stencil_enable){
  if(v594){
  v1.enable(2960);
  }
  else{
  v1.disable(2960);
  }
  v5.stencil_enable=v594;
  }
  v595=v4.stencil_mask;
  if(v595!==v5.stencil_mask){
  v1.stencilMask(v595);
  v5.stencil_mask=v595;
  }
  v596=v34[0];
  v597=v34[1];
  v598=v34[2];
  if(v596!==v35[0]||v597!==v35[1]||v598!==v35[2]){
  v1.stencilFunc(v596,v597,v598);
  v35[0]=v596;
  v35[1]=v597;
  v35[2]=v598;
  }
  v599=v36[0];
  v600=v36[1];
  v601=v36[2];
  v602=v36[3];
  if(v599!==v37[0]||v600!==v37[1]||v601!==v37[2]||v602!==v37[3]){
  v1.stencilOpSeparate(v599,v600,v601,v602);
  v37[0]=v599;
  v37[1]=v600;
  v37[2]=v601;
  v37[3]=v602;
  }
  v603=v38[0];
  v604=v38[1];
  v605=v38[2];
  v606=v38[3];
  if(v603!==v39[0]||v604!==v39[1]||v605!==v39[2]||v606!==v39[3]){
  v1.stencilOpSeparate(v603,v604,v605,v606);
  v39[0]=v603;
  v39[1]=v604;
  v39[2]=v605;
  v39[3]=v606;
  }
  }
  v1.blendColor(0,0,0,0);
  v21[0]=0;
  v21[1]=0;
  v21[2]=0;
  v21[3]=0;
  if(_gs[76]){
  v1.enable(3042);
  }
  else{
  v1.disable(3042);
  }
  v5.blend_enable=_gs[77];
  v1.blendEquationSeparate(32774,32774);
  v23[0]=32774;
  v23[1]=32774;
  v1.blendFuncSeparate(770,771,1,1);
  v25[0]=770;
  v25[1]=771;
  v25[2]=1;
  v25[3]=1;
  if(_gs[78]){
  v1.enable(2884);
  }
  else{
  v1.disable(2884);
  }
  v5.cull_enable=_gs[79];
  v1.cullFace(_gs[80]);
  v5.cull_face=_gs[81];
  if(_gs[82]){
  v1.enable(2929);
  }
  else{
  v1.disable(2929);
  }
  v5.depth_enable=_gs[83];
  v1.depthFunc(_gs[84]);
  v5.depth_func=_gs[85];
  v1.depthMask(_gs[86]);
  v5.depth_mask=_gs[87];
  v1.depthRange(0,1);
  v27[0]=0;
  v27[1]=1;
  if(_gs[88]){
  v1.enable(3024);
  }
  else{
  v1.disable(3024);
  }
  v5.dither=_gs[89];
  v1.lineWidth(_gs[90]);
  v5.lineWidth=_gs[91];
  if(_gs[92]){
  v1.enable(3089);
  }
  else{
  v1.disable(3089);
  }
  v5.scissor_enable=_gs[93];
  v607=v5.profile;
  v5.profile=false;
  v1.useProgram(g102.program);
  var v628,v629,v630,v631,v632,v633,v634,v635,v636,v637,v638,v639,v640,v641,v642,v643,v644,v645,v646,v647,v648,v649,v650,v651,v652,v653,v654,v655,v656,v657,v658,v659,v722;
  v11.setVAO(null);
  v628=g104.location;
  v629=v10[v628];
  if(!v629.buffer){
  v1.enableVertexAttribArray(v628);
  }
  if(v629.type!==g103.dtype||v629.size!==4||v629.buffer!==g103||v629.normalized!==false||v629.offset!==0||v629.stride!==0){
  v1.bindBuffer(34962,g103.buffer);
  v1.vertexAttribPointer(v628,4,g103.dtype,false,0,0);
  v629.type=g103.dtype;
  v629.size=4;
  v629.buffer=g103;
  v629.normalized=false;
  v629.offset=0;
  v629.stride=0;
  }
  v630=g108.location;
  v631=v10[v630];
  if(!v631.buffer){
  v1.enableVertexAttribArray(v630);
  }
  if(v631.type!==g107.dtype||v631.size!==4||v631.buffer!==g107||v631.normalized!==false||v631.offset!==0||v631.stride!==0){
  v1.bindBuffer(34962,g107.buffer);
  v1.vertexAttribPointer(v630,4,g107.dtype,false,0,0);
  v631.type=g107.dtype;
  v631.size=4;
  v631.buffer=g107;
  v631.normalized=false;
  v631.offset=0;
  v631.stride=0;
  }
  v632=g112.location;
  v633=v10[v632];
  if(!v633.buffer){
  v1.enableVertexAttribArray(v632);
  }
  if(v633.type!==g111.dtype||v633.size!==4||v633.buffer!==g111||v633.normalized!==false||v633.offset!==0||v633.stride!==0){
  v1.bindBuffer(34962,g111.buffer);
  v1.vertexAttribPointer(v632,4,g111.dtype,false,0,0);
  v633.type=g111.dtype;
  v633.size=4;
  v633.buffer=g111;
  v633.normalized=false;
  v633.offset=0;
  v633.stride=0;
  }
  v634=g116.location;
  v635=v10[v634];
  if(!v635.buffer){
  v1.enableVertexAttribArray(v634);
  }
  if(v635.type!==g115.dtype||v635.size!==4||v635.buffer!==g115||v635.normalized!==false||v635.offset!==0||v635.stride!==0){
  v1.bindBuffer(34962,g115.buffer);
  v1.vertexAttribPointer(v634,4,g115.dtype,false,0,0);
  v635.type=g115.dtype;
  v635.size=4;
  v635.buffer=g115;
  v635.normalized=false;
  v635.offset=0;
  v635.stride=0;
  }
  v636=g120.location;
  v637=v10[v636];
  if(!v637.buffer){
  v1.enableVertexAttribArray(v636);
  }
  if(v637.type!==g119.dtype||v637.size!==4||v637.buffer!==g119||v637.normalized!==false||v637.offset!==0||v637.stride!==0){
  v1.bindBuffer(34962,g119.buffer);
  v1.vertexAttribPointer(v636,4,g119.dtype,false,0,0);
  v637.type=g119.dtype;
  v637.size=4;
  v637.buffer=g119;
  v637.normalized=false;
  v637.offset=0;
  v637.stride=0;
  }
  v638=g124.location;
  v639=v10[v638];
  if(!v639.buffer){
  v1.enableVertexAttribArray(v638);
  }
  if(v639.type!==g123.dtype||v639.size!==4||v639.buffer!==g123||v639.normalized!==false||v639.offset!==0||v639.stride!==0){
  v1.bindBuffer(34962,g123.buffer);
  v1.vertexAttribPointer(v638,4,g123.dtype,false,0,0);
  v639.type=g123.dtype;
  v639.size=4;
  v639.buffer=g123;
  v639.normalized=false;
  v639.offset=0;
  v639.stride=0;
  }
  v640=g128.location;
  v641=v10[v640];
  if(!v641.buffer){
  v1.enableVertexAttribArray(v640);
  }
  if(v641.type!==g127.dtype||v641.size!==4||v641.buffer!==g127||v641.normalized!==false||v641.offset!==0||v641.stride!==0){
  v1.bindBuffer(34962,g127.buffer);
  v1.vertexAttribPointer(v640,4,g127.dtype,false,0,0);
  v641.type=g127.dtype;
  v641.size=4;
  v641.buffer=g127;
  v641.normalized=false;
  v641.offset=0;
  v641.stride=0;
  }
  v642=g132.location;
  v643=v10[v642];
  if(!v643.buffer){
  v1.enableVertexAttribArray(v642);
  }
  if(v643.type!==g131.dtype||v643.size!==4||v643.buffer!==g131||v643.normalized!==false||v643.offset!==0||v643.stride!==0){
  v1.bindBuffer(34962,g131.buffer);
  v1.vertexAttribPointer(v642,4,g131.dtype,false,0,0);
  v643.type=g131.dtype;
  v643.size=4;
  v643.buffer=g131;
  v643.normalized=false;
  v643.offset=0;
  v643.stride=0;
  }
  v644=g136.location;
  v645=v10[v644];
  if(!v645.buffer){
  v1.enableVertexAttribArray(v644);
  }
  if(v645.type!==g135.dtype||v645.size!==4||v645.buffer!==g135||v645.normalized!==false||v645.offset!==0||v645.stride!==0){
  v1.bindBuffer(34962,g135.buffer);
  v1.vertexAttribPointer(v644,4,g135.dtype,false,0,0);
  v645.type=g135.dtype;
  v645.size=4;
  v645.buffer=g135;
  v645.normalized=false;
  v645.offset=0;
  v645.stride=0;
  }
  v646=g140.location;
  v647=v10[v646];
  if(!v647.buffer){
  v1.enableVertexAttribArray(v646);
  }
  if(v647.type!==g139.dtype||v647.size!==4||v647.buffer!==g139||v647.normalized!==false||v647.offset!==0||v647.stride!==0){
  v1.bindBuffer(34962,g139.buffer);
  v1.vertexAttribPointer(v646,4,g139.dtype,false,0,0);
  v647.type=g139.dtype;
  v647.size=4;
  v647.buffer=g139;
  v647.normalized=false;
  v647.offset=0;
  v647.stride=0;
  }
  v648=g144.location;
  v649=v10[v648];
  if(!v649.buffer){
  v1.enableVertexAttribArray(v648);
  }
  if(v649.type!==g143.dtype||v649.size!==4||v649.buffer!==g143||v649.normalized!==false||v649.offset!==0||v649.stride!==0){
  v1.bindBuffer(34962,g143.buffer);
  v1.vertexAttribPointer(v648,4,g143.dtype,false,0,0);
  v649.type=g143.dtype;
  v649.size=4;
  v649.buffer=g143;
  v649.normalized=false;
  v649.offset=0;
  v649.stride=0;
  }
  v650=g148.location;
  v651=v10[v650];
  if(!v651.buffer){
  v1.enableVertexAttribArray(v650);
  }
  if(v651.type!==g147.dtype||v651.size!==4||v651.buffer!==g147||v651.normalized!==false||v651.offset!==0||v651.stride!==0){
  v1.bindBuffer(34962,g147.buffer);
  v1.vertexAttribPointer(v650,4,g147.dtype,false,0,0);
  v651.type=g147.dtype;
  v651.size=4;
  v651.buffer=g147;
  v651.normalized=false;
  v651.offset=0;
  v651.stride=0;
  }
  v652=g152.location;
  v653=v10[v652];
  if(!v653.buffer){
  v1.enableVertexAttribArray(v652);
  }
  if(v653.type!==g151.dtype||v653.size!==4||v653.buffer!==g151||v653.normalized!==false||v653.offset!==0||v653.stride!==0){
  v1.bindBuffer(34962,g151.buffer);
  v1.vertexAttribPointer(v652,4,g151.dtype,false,0,0);
  v653.type=g151.dtype;
  v653.size=4;
  v653.buffer=g151;
  v653.normalized=false;
  v653.offset=0;
  v653.stride=0;
  }
  v654=g156.location;
  v655=v10[v654];
  if(!v655.buffer){
  v1.enableVertexAttribArray(v654);
  }
  if(v655.type!==g155.dtype||v655.size!==4||v655.buffer!==g155||v655.normalized!==false||v655.offset!==0||v655.stride!==0){
  v1.bindBuffer(34962,g155.buffer);
  v1.vertexAttribPointer(v654,4,g155.dtype,false,0,0);
  v655.type=g155.dtype;
  v655.size=4;
  v655.buffer=g155;
  v655.normalized=false;
  v655.offset=0;
  v655.stride=0;
  }
  v656=g160.location;
  v657=v10[v656];
  if(!v657.buffer){
  v1.enableVertexAttribArray(v656);
  }
  if(v657.type!==g159.dtype||v657.size!==4||v657.buffer!==g159||v657.normalized!==false||v657.offset!==0||v657.stride!==0){
  v1.bindBuffer(34962,g159.buffer);
  v1.vertexAttribPointer(v656,4,g159.dtype,false,0,0);
  v657.type=g159.dtype;
  v657.size=4;
  v657.buffer=g159;
  v657.normalized=false;
  v657.offset=0;
  v657.stride=0;
  }
  v658=g164.location;
  v659=v10[v658];
  if(!v659.buffer){
  v1.enableVertexAttribArray(v658);
  }
  if(v659.type!==g163.dtype||v659.size!==4||v659.buffer!==g163||v659.normalized!==false||v659.offset!==0||v659.stride!==0){
  v1.bindBuffer(34962,g163.buffer);
  v1.vertexAttribPointer(v658,4,g163.dtype,false,0,0);
  v659.type=g163.dtype;
  v659.size=4;
  v659.buffer=g163;
  v659.normalized=false;
  v659.offset=0;
  v659.stride=0;
  }
  v1.uniform1i(g248.location,g249.bind());
  v722=v6.elements;
  if(v722){
  v1.bindBuffer(34963,v722.buffer.buffer);
  }
  else if(v11.currentVAO){
  v722=v7.getElements(v11.currentVAO.elements);
  if(v722)v1.bindBuffer(34963,v722.buffer.buffer);
  }
  for(v608=0;
  v608<a1;
  ++v608){
  v609=a0[v608];
  var v610,v611,v612,v613,v614,v615,v616,v617,v618,v619,v620,v621,v622,v623,v624,v625,v626,v627,v660,v661,v662,v663,v664,v665,v666,v667,v668,v669,v671,v673,v675,v677,v679,v681,v683,v685,v686,v687,v689,v691,v693,v695,v697,v699,v701,v703,v704,v705,v706,v707,v708,v709,v710,v711,v712,v713,v714,v715,v716,v717,v718,v719,v720,v721,v723,v724;
  v610=v609["viewportX"];
  v53.x=v610;
  v611=v609["viewportY"];
  v53.y=v611;
  v612=v609["viewportWidth"];
  v53.width=v612;
  v613=v609["viewportHeight"];
  v53.height=v613;
  if(!(v53&&typeof v53==="object"))g18.commandRaise(g85,g19);
  v614=v53.x|0;
  v615=v53.y|0;
  v616="width" in v53?v53.width|0:(v2.framebufferWidth-v614);
  v617="height" in v53?v53.height|0:(v2.framebufferHeight-v615);
  if(!(v616>=0&&v617>=0))g18.commandRaise(g85,g19);
  v618=v2.viewportWidth;
  v2.viewportWidth=v616;
  v619=v2.viewportHeight;
  v2.viewportHeight=v617;
  v1.viewport(v614,v615,v616,v617);
  v43[0]=v614;
  v43[1]=v615;
  v43[2]=v616;
  v43[3]=v617;
  v620=v609["scissorX"];
  v54.x=v620;
  v621=v609["scissorY"];
  v54.y=v621;
  v622=v609["scissorWidth"];
  v54.width=v622;
  v623=v609["scissorHeight"];
  v54.height=v623;
  if(!(v54&&typeof v54==="object"))g18.commandRaise(g96,g19);
  v624=v54.x|0;
  v625=v54.y|0;
  v626="width" in v54?v54.width|0:(v2.framebufferWidth-v624);
  v627="height" in v54?v54.height|0:(v2.framebufferHeight-v625);
  if(!(v626>=0&&v627>=0))g18.commandRaise(g96,g19);
  v1.scissor(v624,v625,v626,v627);
  v41[0]=v624;
  v41[1]=v625;
  v41[2]=v626;
  v41[3]=v627;
  v660=v609["contextColor"];
  if(!(v17(v660)&&v660.length===4))g18.commandRaise(g169,g19);
  v661=v660[0];
  v663=v660[1];
  v665=v660[2];
  v667=v660[3];
  if(!v608||v662!==v661||v664!==v663||v666!==v665||v668!==v667){
  v662=v661;
  v664=v663;
  v666=v665;
  v668=v667;
  v1.uniform4f(g167.location,v661,v663,v665,v667);
  }
  v669=v609["dim0A"];
  if(!(v17(v669)&&v669.length===16))g18.commandRaise(g176,g19);
  v1.uniformMatrix4fv(g174.location,false,(Array.isArray(v669)||v669 instanceof Float32Array)?v669:(v670[0]=v669[0],v670[1]=v669[1],v670[2]=v669[2],v670[3]=v669[3],v670[4]=v669[4],v670[5]=v669[5],v670[6]=v669[6],v670[7]=v669[7],v670[8]=v669[8],v670[9]=v669[9],v670[10]=v669[10],v670[11]=v669[11],v670[12]=v669[12],v670[13]=v669[13],v670[14]=v669[14],v670[15]=v669[15],v670));
  v671=v609["dim0B"];
  if(!(v17(v671)&&v671.length===16))g18.commandRaise(g180,g19);
  v1.uniformMatrix4fv(g178.location,false,(Array.isArray(v671)||v671 instanceof Float32Array)?v671:(v672[0]=v671[0],v672[1]=v671[1],v672[2]=v671[2],v672[3]=v671[3],v672[4]=v671[4],v672[5]=v671[5],v672[6]=v671[6],v672[7]=v671[7],v672[8]=v671[8],v672[9]=v671[9],v672[10]=v671[10],v672[11]=v671[11],v672[12]=v671[12],v672[13]=v671[13],v672[14]=v671[14],v672[15]=v671[15],v672));
  v673=v609["dim0C"];
  if(!(v17(v673)&&v673.length===16))g18.commandRaise(g184,g19);
  v1.uniformMatrix4fv(g182.location,false,(Array.isArray(v673)||v673 instanceof Float32Array)?v673:(v674[0]=v673[0],v674[1]=v673[1],v674[2]=v673[2],v674[3]=v673[3],v674[4]=v673[4],v674[5]=v673[5],v674[6]=v673[6],v674[7]=v673[7],v674[8]=v673[8],v674[9]=v673[9],v674[10]=v673[10],v674[11]=v673[11],v674[12]=v673[12],v674[13]=v673[13],v674[14]=v673[14],v674[15]=v673[15],v674));
  v675=v609["dim0D"];
  if(!(v17(v675)&&v675.length===16))g18.commandRaise(g188,g19);
  v1.uniformMatrix4fv(g186.location,false,(Array.isArray(v675)||v675 instanceof Float32Array)?v675:(v676[0]=v675[0],v676[1]=v675[1],v676[2]=v675[2],v676[3]=v675[3],v676[4]=v675[4],v676[5]=v675[5],v676[6]=v675[6],v676[7]=v675[7],v676[8]=v675[8],v676[9]=v675[9],v676[10]=v675[10],v676[11]=v675[11],v676[12]=v675[12],v676[13]=v675[13],v676[14]=v675[14],v676[15]=v675[15],v676));
  v677=v609["dim1A"];
  if(!(v17(v677)&&v677.length===16))g18.commandRaise(g192,g19);
  v1.uniformMatrix4fv(g190.location,false,(Array.isArray(v677)||v677 instanceof Float32Array)?v677:(v678[0]=v677[0],v678[1]=v677[1],v678[2]=v677[2],v678[3]=v677[3],v678[4]=v677[4],v678[5]=v677[5],v678[6]=v677[6],v678[7]=v677[7],v678[8]=v677[8],v678[9]=v677[9],v678[10]=v677[10],v678[11]=v677[11],v678[12]=v677[12],v678[13]=v677[13],v678[14]=v677[14],v678[15]=v677[15],v678));
  v679=v609["dim1B"];
  if(!(v17(v679)&&v679.length===16))g18.commandRaise(g196,g19);
  v1.uniformMatrix4fv(g194.location,false,(Array.isArray(v679)||v679 instanceof Float32Array)?v679:(v680[0]=v679[0],v680[1]=v679[1],v680[2]=v679[2],v680[3]=v679[3],v680[4]=v679[4],v680[5]=v679[5],v680[6]=v679[6],v680[7]=v679[7],v680[8]=v679[8],v680[9]=v679[9],v680[10]=v679[10],v680[11]=v679[11],v680[12]=v679[12],v680[13]=v679[13],v680[14]=v679[14],v680[15]=v679[15],v680));
  v681=v609["dim1C"];
  if(!(v17(v681)&&v681.length===16))g18.commandRaise(g200,g19);
  v1.uniformMatrix4fv(g198.location,false,(Array.isArray(v681)||v681 instanceof Float32Array)?v681:(v682[0]=v681[0],v682[1]=v681[1],v682[2]=v681[2],v682[3]=v681[3],v682[4]=v681[4],v682[5]=v681[5],v682[6]=v681[6],v682[7]=v681[7],v682[8]=v681[8],v682[9]=v681[9],v682[10]=v681[10],v682[11]=v681[11],v682[12]=v681[12],v682[13]=v681[13],v682[14]=v681[14],v682[15]=v681[15],v682));
  v683=v609["dim1D"];
  if(!(v17(v683)&&v683.length===16))g18.commandRaise(g204,g19);
  v1.uniformMatrix4fv(g202.location,false,(Array.isArray(v683)||v683 instanceof Float32Array)?v683:(v684[0]=v683[0],v684[1]=v683[1],v684[2]=v683[2],v684[3]=v683[3],v684[4]=v683[4],v684[5]=v683[5],v684[6]=v683[6],v684[7]=v683[7],v684[8]=v683[8],v684[9]=v683[9],v684[10]=v683[10],v684[11]=v683[11],v684[12]=v683[12],v684[13]=v683[13],v684[14]=v683[14],v684[15]=v683[15],v684));
  v685=v609["drwLayer"];
  if(!(typeof v685==="number"))g18.commandRaise(g208,g19);
  if(!v608||v686!==v685){
  v686=v685;
  v1.uniform1f(g206.location,v685);
  }
  v687=v609["hiA"];
  if(!(v17(v687)&&v687.length===16))g18.commandRaise(g211,g19);
  v1.uniformMatrix4fv(g209.location,false,(Array.isArray(v687)||v687 instanceof Float32Array)?v687:(v688[0]=v687[0],v688[1]=v687[1],v688[2]=v687[2],v688[3]=v687[3],v688[4]=v687[4],v688[5]=v687[5],v688[6]=v687[6],v688[7]=v687[7],v688[8]=v687[8],v688[9]=v687[9],v688[10]=v687[10],v688[11]=v687[11],v688[12]=v687[12],v688[13]=v687[13],v688[14]=v687[14],v688[15]=v687[15],v688));
  v689=v609["hiB"];
  if(!(v17(v689)&&v689.length===16))g18.commandRaise(g215,g19);
  v1.uniformMatrix4fv(g213.location,false,(Array.isArray(v689)||v689 instanceof Float32Array)?v689:(v690[0]=v689[0],v690[1]=v689[1],v690[2]=v689[2],v690[3]=v689[3],v690[4]=v689[4],v690[5]=v689[5],v690[6]=v689[6],v690[7]=v689[7],v690[8]=v689[8],v690[9]=v689[9],v690[10]=v689[10],v690[11]=v689[11],v690[12]=v689[12],v690[13]=v689[13],v690[14]=v689[14],v690[15]=v689[15],v690));
  v691=v609["hiC"];
  if(!(v17(v691)&&v691.length===16))g18.commandRaise(g219,g19);
  v1.uniformMatrix4fv(g217.location,false,(Array.isArray(v691)||v691 instanceof Float32Array)?v691:(v692[0]=v691[0],v692[1]=v691[1],v692[2]=v691[2],v692[3]=v691[3],v692[4]=v691[4],v692[5]=v691[5],v692[6]=v691[6],v692[7]=v691[7],v692[8]=v691[8],v692[9]=v691[9],v692[10]=v691[10],v692[11]=v691[11],v692[12]=v691[12],v692[13]=v691[13],v692[14]=v691[14],v692[15]=v691[15],v692));
  v693=v609["hiD"];
  if(!(v17(v693)&&v693.length===16))g18.commandRaise(g223,g19);
  v1.uniformMatrix4fv(g221.location,false,(Array.isArray(v693)||v693 instanceof Float32Array)?v693:(v694[0]=v693[0],v694[1]=v693[1],v694[2]=v693[2],v694[3]=v693[3],v694[4]=v693[4],v694[5]=v693[5],v694[6]=v693[6],v694[7]=v693[7],v694[8]=v693[8],v694[9]=v693[9],v694[10]=v693[10],v694[11]=v693[11],v694[12]=v693[12],v694[13]=v693[13],v694[14]=v693[14],v694[15]=v693[15],v694));
  v695=v609["loA"];
  if(!(v17(v695)&&v695.length===16))g18.commandRaise(g227,g19);
  v1.uniformMatrix4fv(g225.location,false,(Array.isArray(v695)||v695 instanceof Float32Array)?v695:(v696[0]=v695[0],v696[1]=v695[1],v696[2]=v695[2],v696[3]=v695[3],v696[4]=v695[4],v696[5]=v695[5],v696[6]=v695[6],v696[7]=v695[7],v696[8]=v695[8],v696[9]=v695[9],v696[10]=v695[10],v696[11]=v695[11],v696[12]=v695[12],v696[13]=v695[13],v696[14]=v695[14],v696[15]=v695[15],v696));
  v697=v609["loB"];
  if(!(v17(v697)&&v697.length===16))g18.commandRaise(g231,g19);
  v1.uniformMatrix4fv(g229.location,false,(Array.isArray(v697)||v697 instanceof Float32Array)?v697:(v698[0]=v697[0],v698[1]=v697[1],v698[2]=v697[2],v698[3]=v697[3],v698[4]=v697[4],v698[5]=v697[5],v698[6]=v697[6],v698[7]=v697[7],v698[8]=v697[8],v698[9]=v697[9],v698[10]=v697[10],v698[11]=v697[11],v698[12]=v697[12],v698[13]=v697[13],v698[14]=v697[14],v698[15]=v697[15],v698));
  v699=v609["loC"];
  if(!(v17(v699)&&v699.length===16))g18.commandRaise(g235,g19);
  v1.uniformMatrix4fv(g233.location,false,(Array.isArray(v699)||v699 instanceof Float32Array)?v699:(v700[0]=v699[0],v700[1]=v699[1],v700[2]=v699[2],v700[3]=v699[3],v700[4]=v699[4],v700[5]=v699[5],v700[6]=v699[6],v700[7]=v699[7],v700[8]=v699[8],v700[9]=v699[9],v700[10]=v699[10],v700[11]=v699[11],v700[12]=v699[12],v700[13]=v699[13],v700[14]=v699[14],v700[15]=v699[15],v700));
  v701=v609["loD"];
  if(!(v17(v701)&&v701.length===16))g18.commandRaise(g239,g19);
  v1.uniformMatrix4fv(g237.location,false,(Array.isArray(v701)||v701 instanceof Float32Array)?v701:(v702[0]=v701[0],v702[1]=v701[1],v702[2]=v701[2],v702[3]=v701[3],v702[4]=v701[4],v702[5]=v701[5],v702[6]=v701[6],v702[7]=v701[7],v702[8]=v701[8],v702[9]=v701[9],v702[10]=v701[10],v702[11]=v701[11],v702[12]=v701[12],v702[13]=v701[13],v702[14]=v701[14],v702[15]=v701[15],v702));
  v703=v609["maskHeight"];
  if(!(typeof v703==="number"))g18.commandRaise(g243,g19);
  if(!v608||v704!==v703){
  v704=v703;
  v1.uniform1f(g241.location,v703);
  }
  v705=v609["maskTexture"];
  if(v705&&v705._reglType==="framebuffer"){
  v705=v705.color[0];
  }
  if(!(typeof v705==="function"&&v705._reglType==="texture2d"))g18.commandRaise(g246,g19);
  v706=v705._texture;
  v1.uniform1i(g244.location,v706.bind());
  v707=v609["resolution"];
  if(!(v17(v707)&&v707.length===2))g18.commandRaise(g252,g19);
  v708=v707[0];
  v710=v707[1];
  if(!v608||v709!==v708||v711!==v710){
  v709=v708;
  v711=v710;
  v1.uniform2f(g250.location,v708,v710);
  }
  v712=v609["viewBoxPos"];
  if(!(v17(v712)&&v712.length===2))g18.commandRaise(g257,g19);
  v713=v712[0];
  v715=v712[1];
  if(!v608||v714!==v713||v716!==v715){
  v714=v713;
  v716=v715;
  v1.uniform2f(g255.location,v713,v715);
  }
  v717=v609["viewBoxSize"];
  if(!(v17(v717)&&v717.length===2))g18.commandRaise(g262,g19);
  v718=v717[0];
  v720=v717[1];
  if(!v608||v719!==v718||v721!==v720){
  v719=v718;
  v721=v720;
  v1.uniform2f(g260.location,v718,v720);
  }
  v723=v609["offset"];
  if(!(v723>=0))g18.commandRaise(g267,g19);
  v724=v609["count"];
  if(!(typeof v724==="number"&&v724>=0&&v724===(v724|0)))g18.commandRaise(g269,g19);
  if(v724){
  if(v722){
  v1.drawElements(1,v724,v722.type,v723<<((v722.type-5121)>>1));
  }
  else{
  v1.drawArrays(1,v723,v724);
  }
  v2.viewportWidth=v618;
  v2.viewportHeight=v619;
  v706.unbind();
  }
  }
  g249.unbind();
  v5.dirty=true;
  v11.setVAO(null);
  v5.profile=v607;
  }
  ,}
  
  },
  };

var getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

function slice (x) {
  return Array.prototype.slice.call(x)
}

function join (x) {
  return slice(x).join('')
}

function createEnvironment (debug) {
  // Unique variable id counter
  var varCounter = 0

  // Linked values are passed from this scope into the generated code block
  // Calling link() passes a value into the generated scope and returns
  // the variable name which it is bound to
  var linkedNames = []
  var linkedValues = []

  function link (value) {
    for (var i = 0; i < linkedValues.length; ++i) {
      if (linkedValues[i] === value) {
        return linkedNames[i]
      }
    }

    var name = 'g' + (varCounter++)
    linkedNames.push(name)
    linkedValues.push(value)
    return name
  }

  // create a code block
  function block () {
    var code = []
    function push () {
     // code.push("/* " + new Error().stack + " */\n");
      code.push.apply(code, slice(arguments))
    }
    var vars = []
    function def () {
    //  code.push("/* " + new Error().stack + " */\n");
      var name = 'v' + (varCounter++)
      vars.push(name)

      if (arguments.length > 0) {
        code.push(name, '=')
        code.push.apply(code, slice(arguments))
        code.push(';')
      }

      return name
    }

    return extend(push, {
      def: def,
      toString: function () {
        return join([
          (vars.length > 0 ? 'var ' + vars.join(',') + ';' : ''),
          join(code)
        ])
      }
    })
  }

  function scope () {
    var entry = block()
    var exit = block()

    var entryToString = entry.toString
    var exitToString = exit.toString

    function save (object, prop) {
      exit(object, prop, '=', entry.def(object, prop), ';')
    }

    return extend(function () {
      entry.apply(entry, slice(arguments))
    }, {
      def: entry.def,
      entry: entry,
      exit: exit,
      save: save,
      set: function (object, prop, value) {
        save(object, prop)
        entry(object, prop, '=', value, ';')
      },
      toString: function () {
        return entryToString() + exitToString()
      }
    })
  }

  function conditional () {
    
    var pred = join(arguments)
    var thenBlock = scope()
    var elseBlock = scope()

    var thenToString = thenBlock.toString
    var elseToString = elseBlock.toString

    return extend(thenBlock, {
      then: function () {
        thenBlock.apply(thenBlock, slice(arguments))
        return this
      },
      else: function () {
        elseBlock.apply(elseBlock, slice(arguments))
        return this
      },
      toString: function () {
        var elseClause = elseToString()
        if (elseClause) {
          elseClause = 'else{' + elseClause + '}'
        }
        return join([
          'if(', pred, '){',
          thenToString(),
          '}', elseClause
        ])
      }
    })
  }

  // procedure list
  var globalBlock = block()
  var procedures = {}
  function proc (name, count) {
    var args = []
    function arg () {
      var name = 'a' + args.length
      args.push(name)
      return name
    }

    count = count || 0
    for (var i = 0; i < count; ++i) {
      arg()
    }

    var body = scope()
    var bodyToString = body.toString

    var result = procedures[name] = extend(body, {
      arg: arg,
      toString: function () {
        return join([
          'function(', args.join(), '){',
          bodyToString(),
          '}'
        ])
      }
    })

    return result
  }

  var debugBlock = "/*\n" + 
    JSON.stringify(debug, getCircularReplacer(), 2) +
    "\n*/\n";

  function compile (globalScope) {
    var code = ['"use strict";',
      // debugBlock,
      globalBlock,
      'return {']
    Object.keys(procedures).forEach(function (name) {
      code.push('"', name, '":', procedures[name].toString(), ',')
    })
    code.push('}')
    var src = join(code)
      .replace(/;/g, ';\n')
      .replace(/}/g, '}\n')
      .replace(/{/g, '{\n')


    // fetch('http://localhost:8080/code', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify({
    //       code: src,
    //       linkedNames: linkedNames,
    //       stackTrace: Error().stack,
    //       location: {
    //         agent: window.navigator.userAgent,
    //         href: window.location.href,
    //       } 
    //     })
    //   });

      
    var codeHash = src.length + "." + linkedNames.join(",").length;
    
    if (!precompiled[codeHash]) {
      throw new Error('Could not find precompiled shader for hash ' + codeHash)
    }

    return precompiled[codeHash](globalScope, ...linkedValues);

    // var proc = Function.apply(null, ["_gs"].concat(linkedNames).concat(src))
    // return proc.apply(null, [globalScope].concat(linkedValues))
  }

  return {
    global: globalBlock,
    link: link,
    block: block,
    proc: proc,
    scope: scope,
    cond: conditional,
    compile: compile
  }
}

// "cute" names for vector components
var CUTE_COMPONENTS = 'xyzw'.split('')

var GL_UNSIGNED_BYTE$8 = 5121

var ATTRIB_STATE_POINTER = 1
var ATTRIB_STATE_CONSTANT = 2

var DYN_FUNC$1 = 0
var DYN_PROP$1 = 1
var DYN_CONTEXT$1 = 2
var DYN_STATE$1 = 3
var DYN_THUNK = 4
var DYN_CONSTANT$1 = 5
var DYN_ARRAY$1 = 6

var S_DITHER = 'dither'
var S_BLEND_ENABLE = 'blend.enable'
var S_BLEND_COLOR = 'blend.color'
var S_BLEND_EQUATION = 'blend.equation'
var S_BLEND_FUNC = 'blend.func'
var S_DEPTH_ENABLE = 'depth.enable'
var S_DEPTH_FUNC = 'depth.func'
var S_DEPTH_RANGE = 'depth.range'
var S_DEPTH_MASK = 'depth.mask'
var S_COLOR_MASK = 'colorMask'
var S_CULL_ENABLE = 'cull.enable'
var S_CULL_FACE = 'cull.face'
var S_FRONT_FACE = 'frontFace'
var S_LINE_WIDTH = 'lineWidth'
var S_POLYGON_OFFSET_ENABLE = 'polygonOffset.enable'
var S_POLYGON_OFFSET_OFFSET = 'polygonOffset.offset'
var S_SAMPLE_ALPHA = 'sample.alpha'
var S_SAMPLE_ENABLE = 'sample.enable'
var S_SAMPLE_COVERAGE = 'sample.coverage'
var S_STENCIL_ENABLE = 'stencil.enable'
var S_STENCIL_MASK = 'stencil.mask'
var S_STENCIL_FUNC = 'stencil.func'
var S_STENCIL_OPFRONT = 'stencil.opFront'
var S_STENCIL_OPBACK = 'stencil.opBack'
var S_SCISSOR_ENABLE = 'scissor.enable'
var S_SCISSOR_BOX = 'scissor.box'
var S_VIEWPORT = 'viewport'

var S_PROFILE = 'profile'

var S_FRAMEBUFFER = 'framebuffer'
var S_VERT = 'vert'
var S_FRAG = 'frag'
var S_ELEMENTS = 'elements'
var S_PRIMITIVE = 'primitive'
var S_COUNT = 'count'
var S_OFFSET = 'offset'
var S_INSTANCES = 'instances'
var S_VAO = 'vao'

var SUFFIX_WIDTH = 'Width'
var SUFFIX_HEIGHT = 'Height'

var S_FRAMEBUFFER_WIDTH = S_FRAMEBUFFER + SUFFIX_WIDTH
var S_FRAMEBUFFER_HEIGHT = S_FRAMEBUFFER + SUFFIX_HEIGHT
var S_VIEWPORT_WIDTH = S_VIEWPORT + SUFFIX_WIDTH
var S_VIEWPORT_HEIGHT = S_VIEWPORT + SUFFIX_HEIGHT
var S_DRAWINGBUFFER = 'drawingBuffer'
var S_DRAWINGBUFFER_WIDTH = S_DRAWINGBUFFER + SUFFIX_WIDTH
var S_DRAWINGBUFFER_HEIGHT = S_DRAWINGBUFFER + SUFFIX_HEIGHT

var NESTED_OPTIONS = [
  S_BLEND_FUNC,
  S_BLEND_EQUATION,
  S_STENCIL_FUNC,
  S_STENCIL_OPFRONT,
  S_STENCIL_OPBACK,
  S_SAMPLE_COVERAGE,
  S_VIEWPORT,
  S_SCISSOR_BOX,
  S_POLYGON_OFFSET_OFFSET
]

var GL_ARRAY_BUFFER$2 = 34962
var GL_ELEMENT_ARRAY_BUFFER$2 = 34963

var GL_FRAGMENT_SHADER$1 = 35632
var GL_VERTEX_SHADER$1 = 35633

var GL_TEXTURE_2D$3 = 0x0DE1
var GL_TEXTURE_CUBE_MAP$2 = 0x8513

var GL_CULL_FACE = 0x0B44
var GL_BLEND = 0x0BE2
var GL_DITHER = 0x0BD0
var GL_STENCIL_TEST = 0x0B90
var GL_DEPTH_TEST = 0x0B71
var GL_SCISSOR_TEST = 0x0C11
var GL_POLYGON_OFFSET_FILL = 0x8037
var GL_SAMPLE_ALPHA_TO_COVERAGE = 0x809E
var GL_SAMPLE_COVERAGE = 0x80A0

var GL_FLOAT$8 = 5126
var GL_FLOAT_VEC2 = 35664
var GL_FLOAT_VEC3 = 35665
var GL_FLOAT_VEC4 = 35666
var GL_INT$3 = 5124
var GL_INT_VEC2 = 35667
var GL_INT_VEC3 = 35668
var GL_INT_VEC4 = 35669
var GL_BOOL = 35670
var GL_BOOL_VEC2 = 35671
var GL_BOOL_VEC3 = 35672
var GL_BOOL_VEC4 = 35673
var GL_FLOAT_MAT2 = 35674
var GL_FLOAT_MAT3 = 35675
var GL_FLOAT_MAT4 = 35676
var GL_SAMPLER_2D = 35678
var GL_SAMPLER_CUBE = 35680

var GL_TRIANGLES$1 = 4

var GL_FRONT = 1028
var GL_BACK = 1029
var GL_CW = 0x0900
var GL_CCW = 0x0901
var GL_MIN_EXT = 0x8007
var GL_MAX_EXT = 0x8008
var GL_ALWAYS = 519
var GL_KEEP = 7680
var GL_ZERO = 0
var GL_ONE = 1
var GL_FUNC_ADD = 0x8006
var GL_LESS = 513

var GL_FRAMEBUFFER$2 = 0x8D40
var GL_COLOR_ATTACHMENT0$2 = 0x8CE0

var blendFuncs = {
  '0': 0,
  '1': 1,
  'zero': 0,
  'one': 1,
  'src color': 768,
  'one minus src color': 769,
  'src alpha': 770,
  'one minus src alpha': 771,
  'dst color': 774,
  'one minus dst color': 775,
  'dst alpha': 772,
  'one minus dst alpha': 773,
  'constant color': 32769,
  'one minus constant color': 32770,
  'constant alpha': 32771,
  'one minus constant alpha': 32772,
  'src alpha saturate': 776
}

// There are invalid values for srcRGB and dstRGB. See:
// https://www.khronos.org/registry/webgl/specs/1.0/#6.13
// https://github.com/KhronosGroup/WebGL/blob/0d3201f5f7ec3c0060bc1f04077461541f1987b9/conformance-suites/1.0.3/conformance/misc/webgl-specific.html#L56
var invalidBlendCombinations = [
  'constant color, constant alpha',
  'one minus constant color, constant alpha',
  'constant color, one minus constant alpha',
  'one minus constant color, one minus constant alpha',
  'constant alpha, constant color',
  'constant alpha, one minus constant color',
  'one minus constant alpha, constant color',
  'one minus constant alpha, one minus constant color'
]

var compareFuncs = {
  'never': 512,
  'less': 513,
  '<': 513,
  'equal': 514,
  '=': 514,
  '==': 514,
  '===': 514,
  'lequal': 515,
  '<=': 515,
  'greater': 516,
  '>': 516,
  'notequal': 517,
  '!=': 517,
  '!==': 517,
  'gequal': 518,
  '>=': 518,
  'always': 519
}

var stencilOps = {
  '0': 0,
  'zero': 0,
  'keep': 7680,
  'replace': 7681,
  'increment': 7682,
  'decrement': 7683,
  'increment wrap': 34055,
  'decrement wrap': 34056,
  'invert': 5386
}

var shaderType = {
  'frag': GL_FRAGMENT_SHADER$1,
  'vert': GL_VERTEX_SHADER$1
}

var orientationType = {
  'cw': GL_CW,
  'ccw': GL_CCW
}

function isBufferArgs (x) {
  return Array.isArray(x) ||
    isTypedArray(x) ||
    isNDArrayLike(x)
}

// Make sure viewport is processed first
function sortState (state) {
  return state.sort(function (a, b) {
    if (a === S_VIEWPORT) {
      return -1
    } else if (b === S_VIEWPORT) {
      return 1
    }
    return (a < b) ? -1 : 1
  })
}

function Declaration (thisDep, contextDep, propDep, append) {
  this.thisDep = thisDep
  this.contextDep = contextDep
  this.propDep = propDep
  this.append = append
}

function isStatic (decl) {
  return decl && !(decl.thisDep || decl.contextDep || decl.propDep)
}

function createStaticDecl (append) {
  return new Declaration(false, false, false, append)
}

function createDynamicDecl (dyn, append) {
  var type = dyn.type
  if (type === DYN_FUNC$1) {
    var numArgs = dyn.data.length
    return new Declaration(
      true,
      numArgs >= 1,
      numArgs >= 2,
      append)
  } else if (type === DYN_THUNK) {
    var data = dyn.data
    return new Declaration(
      data.thisDep,
      data.contextDep,
      data.propDep,
      append)
  } else if (type === DYN_CONSTANT$1) {
    return new Declaration(
      false,
      false,
      false,
      append)
  } else if (type === DYN_ARRAY$1) {
    var thisDep = false
    var contextDep = false
    var propDep = false
    for (var i = 0; i < dyn.data.length; ++i) {
      var subDyn = dyn.data[i]
      if (subDyn.type === DYN_PROP$1) {
        propDep = true
      } else if (subDyn.type === DYN_CONTEXT$1) {
        contextDep = true
      } else if (subDyn.type === DYN_STATE$1) {
        thisDep = true
      } else if (subDyn.type === DYN_FUNC$1) {
        thisDep = true
        var subArgs = subDyn.data
        if (subArgs >= 1) {
          contextDep = true
        }
        if (subArgs >= 2) {
          propDep = true
        }
      } else if (subDyn.type === DYN_THUNK) {
        thisDep = thisDep || subDyn.data.thisDep
        contextDep = contextDep || subDyn.data.contextDep
        propDep = propDep || subDyn.data.propDep
      }
    }
    return new Declaration(
      thisDep,
      contextDep,
      propDep,
      append)
  } else {
    return new Declaration(
      type === DYN_STATE$1,
      type === DYN_CONTEXT$1,
      type === DYN_PROP$1,
      append)
  }
}

var SCOPE_DECL = new Declaration(false, false, false, function () {})

function reglCore (
  gl,
  stringStore,
  extensions,
  limits,
  bufferState,
  elementState,
  textureState,
  framebufferState,
  uniformState,
  attributeState,
  shaderState,
  drawState,
  contextState,
  timer,
  config) {
  var AttributeRecord = attributeState.Record

  var blendEquations = {
    'add': 32774,
    'subtract': 32778,
    'reverse subtract': 32779
  }
  if (extensions.ext_blend_minmax) {
    blendEquations.min = GL_MIN_EXT
    blendEquations.max = GL_MAX_EXT
  }

  var extInstancing = extensions.angle_instanced_arrays
  var extDrawBuffers = extensions.webgl_draw_buffers
  var extVertexArrays = extensions.oes_vertex_array_object

  // ===================================================
  // ===================================================
  // WEBGL STATE
  // ===================================================
  // ===================================================
  var currentState = {
    dirty: true,
    profile: config.profile
  }
  var nextState = {}
  var GL_STATE_NAMES = []
  var GL_FLAGS = {}
  var GL_VARIABLES = {}

  function propName (name) {
    return name.replace('.', '_')
  }

  function stateFlag (sname, cap, init) {
    var name = propName(sname)
    GL_STATE_NAMES.push(sname)
    nextState[name] = currentState[name] = !!init
    GL_FLAGS[name] = cap
  }

  function stateVariable (sname, func, init) {
    var name = propName(sname)
    GL_STATE_NAMES.push(sname)
    if (Array.isArray(init)) {
      currentState[name] = init.slice()
      nextState[name] = init.slice()
    } else {
      currentState[name] = nextState[name] = init
    }
    GL_VARIABLES[name] = func
  }

  // Dithering
  stateFlag(S_DITHER, GL_DITHER)

  // Blending
  stateFlag(S_BLEND_ENABLE, GL_BLEND)
  stateVariable(S_BLEND_COLOR, 'blendColor', [0, 0, 0, 0])
  stateVariable(S_BLEND_EQUATION, 'blendEquationSeparate',
    [GL_FUNC_ADD, GL_FUNC_ADD])
  stateVariable(S_BLEND_FUNC, 'blendFuncSeparate',
    [GL_ONE, GL_ZERO, GL_ONE, GL_ZERO])

  // Depth
  stateFlag(S_DEPTH_ENABLE, GL_DEPTH_TEST, true)
  stateVariable(S_DEPTH_FUNC, 'depthFunc', GL_LESS)
  stateVariable(S_DEPTH_RANGE, 'depthRange', [0, 1])
  stateVariable(S_DEPTH_MASK, 'depthMask', true)

  // Color mask
  stateVariable(S_COLOR_MASK, S_COLOR_MASK, [true, true, true, true])

  // Face culling
  stateFlag(S_CULL_ENABLE, GL_CULL_FACE)
  stateVariable(S_CULL_FACE, 'cullFace', GL_BACK)

  // Front face orientation
  stateVariable(S_FRONT_FACE, S_FRONT_FACE, GL_CCW)

  // Line width
  stateVariable(S_LINE_WIDTH, S_LINE_WIDTH, 1)

  // Polygon offset
  stateFlag(S_POLYGON_OFFSET_ENABLE, GL_POLYGON_OFFSET_FILL)
  stateVariable(S_POLYGON_OFFSET_OFFSET, 'polygonOffset', [0, 0])

  // Sample coverage
  stateFlag(S_SAMPLE_ALPHA, GL_SAMPLE_ALPHA_TO_COVERAGE)
  stateFlag(S_SAMPLE_ENABLE, GL_SAMPLE_COVERAGE)
  stateVariable(S_SAMPLE_COVERAGE, 'sampleCoverage', [1, false])

  // Stencil
  stateFlag(S_STENCIL_ENABLE, GL_STENCIL_TEST)
  stateVariable(S_STENCIL_MASK, 'stencilMask', -1)
  stateVariable(S_STENCIL_FUNC, 'stencilFunc', [GL_ALWAYS, 0, -1])
  stateVariable(S_STENCIL_OPFRONT, 'stencilOpSeparate',
    [GL_FRONT, GL_KEEP, GL_KEEP, GL_KEEP])
  stateVariable(S_STENCIL_OPBACK, 'stencilOpSeparate',
    [GL_BACK, GL_KEEP, GL_KEEP, GL_KEEP])

  // Scissor
  stateFlag(S_SCISSOR_ENABLE, GL_SCISSOR_TEST)
  stateVariable(S_SCISSOR_BOX, 'scissor',
    [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight])

  // Viewport
  stateVariable(S_VIEWPORT, S_VIEWPORT,
    [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight])

  // ===================================================
  // ===================================================
  // ENVIRONMENT
  // ===================================================
  // ===================================================
  var sharedState = {
    gl: gl,
    context: contextState,
    strings: stringStore,
    next: nextState,
    current: currentState,
    draw: drawState,
    elements: elementState,
    buffer: bufferState,
    shader: shaderState,
    attributes: attributeState.state,
    vao: attributeState,
    uniforms: uniformState,
    framebuffer: framebufferState,
    extensions: extensions,

    timer: timer,
    isBufferArgs: isBufferArgs
  }

  var sharedConstants = {
    primTypes: primTypes,
    compareFuncs: compareFuncs,
    blendFuncs: blendFuncs,
    blendEquations: blendEquations,
    stencilOps: stencilOps,
    glTypes: glTypes,
    orientationType: orientationType
  }

  check$1.optional(function () {
    sharedState.isArrayLike = isArrayLike
  })

  if (extDrawBuffers) {
    sharedConstants.backBuffer = [GL_BACK]
    sharedConstants.drawBuffer = loop(limits.maxDrawbuffers, function (i) {
      if (i === 0) {
        return [0]
      }
      return loop(i, function (j) {
        return GL_COLOR_ATTACHMENT0$2 + j
      })
    })
  }

  var drawCallCounter = 0
  function createREGLEnvironment (debug) {
    var env = createEnvironment(debug)
    var link = env.link
    var global = env.global
    env.id = drawCallCounter++

    env.batchId = '0'

    // link shared state
    var SHARED = link(sharedState)
    var shared = env.shared = {
      props: 'a0'
    }
    Object.keys(sharedState).forEach(function (prop) {
      shared[prop] = global.def(SHARED, '.', prop)
    })

    // Inject runtime assertion stuff for debug builds
    check$1.optional(function () {
      env.CHECK = link(check$1)
      env.commandStr = check$1.guessCommand()
      env.command = link(env.commandStr)
      env.assert = function (block, pred, message) {
        block(
          'if(!(', pred, '))',
          this.CHECK, '.commandRaise(', link(message), ',', this.command, ');')
      }

      sharedConstants.invalidBlendCombinations = invalidBlendCombinations
    })

    // Copy GL state variables over
    var nextVars = env.next = {}
    var currentVars = env.current = {}
    Object.keys(GL_VARIABLES).forEach(function (variable) {
      if (Array.isArray(currentState[variable])) {
        nextVars[variable] = global.def(shared.next, '.', variable)
        currentVars[variable] = global.def(shared.current, '.', variable)
      }
    })

    // Initialize shared constants
    var constants = env.constants = {}
    Object.keys(sharedConstants).forEach(function (name) {
      constants[name] = global.def(JSON.stringify(sharedConstants[name]))
    })

    // Helper function for calling a block
    env.invoke = function (block, x) {
      switch (x.type) {
        case DYN_FUNC$1:
          var argList = [
            'this',
            shared.context,
            shared.props,
            env.batchId
          ]
          return block.def(
            link(x.data), '.call(',
            argList.slice(0, Math.max(x.data.length + 1, 4)),
            ')')
        case DYN_PROP$1:
          return block.def(shared.props, x.data)
        case DYN_CONTEXT$1:
          return block.def(shared.context, x.data)
        case DYN_STATE$1:
          return block.def('this', x.data)
        case DYN_THUNK:
          x.data.append(env, block)
          return x.data.ref
        case DYN_CONSTANT$1:
          return x.data.toString()
        case DYN_ARRAY$1:
          return x.data.map(function (y) {
            return env.invoke(block, y)
          })
      }
    }

    env.attribCache = {}

    var scopeAttribs = {}
    env.scopeAttrib = function (name) {
      var id = stringStore.id(name)
      if (id in scopeAttribs) {
        return scopeAttribs[id]
      }
      var binding = attributeState.scope[id]
      if (!binding) {
        binding = attributeState.scope[id] = new AttributeRecord()
      }
      var result = scopeAttribs[id] = link(binding)
      return result
    }

    return env
  }

  // ===================================================
  // ===================================================
  // PARSING
  // ===================================================
  // ===================================================
  function parseProfile (options) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    var profileEnable
    if (S_PROFILE in staticOptions) {
      var value = !!staticOptions[S_PROFILE]
      profileEnable = createStaticDecl(function (env, scope) {
        return value
      })
      profileEnable.enable = value
    } else if (S_PROFILE in dynamicOptions) {
      var dyn = dynamicOptions[S_PROFILE]
      profileEnable = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    }

    return profileEnable
  }

  function parseFramebuffer (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    if (S_FRAMEBUFFER in staticOptions) {
      var framebuffer = staticOptions[S_FRAMEBUFFER]
      if (framebuffer) {
        framebuffer = framebufferState.getFramebuffer(framebuffer)
        check$1.command(framebuffer, 'invalid framebuffer object')
        return createStaticDecl(function (env, block) {
          var FRAMEBUFFER = env.link(framebuffer)
          var shared = env.shared
          block.set(
            shared.framebuffer,
            '.next',
            FRAMEBUFFER)
          var CONTEXT = shared.context
          block.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_WIDTH,
            FRAMEBUFFER + '.width')
          block.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_HEIGHT,
            FRAMEBUFFER + '.height')
          return FRAMEBUFFER
        })
      } else {
        return createStaticDecl(function (env, scope) {
          var shared = env.shared
          scope.set(
            shared.framebuffer,
            '.next',
            'null')
          var CONTEXT = shared.context
          scope.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_WIDTH,
            CONTEXT + '.' + S_DRAWINGBUFFER_WIDTH)
          scope.set(
            CONTEXT,
            '.' + S_FRAMEBUFFER_HEIGHT,
            CONTEXT + '.' + S_DRAWINGBUFFER_HEIGHT)
          return 'null'
        })
      }
    } else if (S_FRAMEBUFFER in dynamicOptions) {
      var dyn = dynamicOptions[S_FRAMEBUFFER]
      return createDynamicDecl(dyn, function (env, scope) {
        var FRAMEBUFFER_FUNC = env.invoke(scope, dyn)
        var shared = env.shared
        var FRAMEBUFFER_STATE = shared.framebuffer
        var FRAMEBUFFER = scope.def(
          FRAMEBUFFER_STATE, '.getFramebuffer(', FRAMEBUFFER_FUNC, ')')

        check$1.optional(function () {
          env.assert(scope,
            '!' + FRAMEBUFFER_FUNC + '||' + FRAMEBUFFER,
            'invalid framebuffer object')
        })

        scope.set(
          FRAMEBUFFER_STATE,
          '.next',
          FRAMEBUFFER)
        var CONTEXT = shared.context
        scope.set(
          CONTEXT,
          '.' + S_FRAMEBUFFER_WIDTH,
          FRAMEBUFFER + '?' + FRAMEBUFFER + '.width:' +
          CONTEXT + '.' + S_DRAWINGBUFFER_WIDTH)
        scope.set(
          CONTEXT,
          '.' + S_FRAMEBUFFER_HEIGHT,
          FRAMEBUFFER +
          '?' + FRAMEBUFFER + '.height:' +
          CONTEXT + '.' + S_DRAWINGBUFFER_HEIGHT)
        return FRAMEBUFFER
      })
    } else {
      return null
    }
  }

  function parseViewportScissor (options, framebuffer, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    function parseBox (param) {
      if (param in staticOptions) {
        var box = staticOptions[param]
        check$1.commandType(box, 'object', 'invalid ' + param, env.commandStr)

        var isStatic = true
        var x = box.x | 0
        var y = box.y | 0
        var w, h
        if ('width' in box) {
          w = box.width | 0
          check$1.command(w >= 0, 'invalid ' + param, env.commandStr)
        } else {
          isStatic = false
        }
        if ('height' in box) {
          h = box.height | 0
          check$1.command(h >= 0, 'invalid ' + param, env.commandStr)
        } else {
          isStatic = false
        }

        return new Declaration(
          !isStatic && framebuffer && framebuffer.thisDep,
          !isStatic && framebuffer && framebuffer.contextDep,
          !isStatic && framebuffer && framebuffer.propDep,
          function (env, scope) {
            var CONTEXT = env.shared.context
            var BOX_W = w
            if (!('width' in box)) {
              BOX_W = scope.def(CONTEXT, '.', S_FRAMEBUFFER_WIDTH, '-', x)
            }
            var BOX_H = h
            if (!('height' in box)) {
              BOX_H = scope.def(CONTEXT, '.', S_FRAMEBUFFER_HEIGHT, '-', y)
            }
            return [x, y, BOX_W, BOX_H]
          })
      } else if (param in dynamicOptions) {
        var dynBox = dynamicOptions[param]
        var result = createDynamicDecl(dynBox, function (env, scope) {
          var BOX = env.invoke(scope, dynBox)

          check$1.optional(function () {
            env.assert(scope,
              BOX + '&&typeof ' + BOX + '==="object"',
              'invalid ' + param)
          })

          var CONTEXT = env.shared.context
          var BOX_X = scope.def(BOX, '.x|0')
          var BOX_Y = scope.def(BOX, '.y|0')
          var BOX_W = scope.def(
            '"width" in ', BOX, '?', BOX, '.width|0:',
            '(', CONTEXT, '.', S_FRAMEBUFFER_WIDTH, '-', BOX_X, ')')
          var BOX_H = scope.def(
            '"height" in ', BOX, '?', BOX, '.height|0:',
            '(', CONTEXT, '.', S_FRAMEBUFFER_HEIGHT, '-', BOX_Y, ')')

          check$1.optional(function () {
            env.assert(scope,
              BOX_W + '>=0&&' +
              BOX_H + '>=0',
              'invalid ' + param)
          })

          return [BOX_X, BOX_Y, BOX_W, BOX_H]
        })
        if (framebuffer) {
          result.thisDep = result.thisDep || framebuffer.thisDep
          result.contextDep = result.contextDep || framebuffer.contextDep
          result.propDep = result.propDep || framebuffer.propDep
        }
        return result
      } else if (framebuffer) {
        return new Declaration(
          framebuffer.thisDep,
          framebuffer.contextDep,
          framebuffer.propDep,
          function (env, scope) {
            var CONTEXT = env.shared.context
            return [
              0, 0,
              scope.def(CONTEXT, '.', S_FRAMEBUFFER_WIDTH),
              scope.def(CONTEXT, '.', S_FRAMEBUFFER_HEIGHT)]
          })
      } else {
        return null
      }
    }

    var viewport = parseBox(S_VIEWPORT)

    if (viewport) {
      var prevViewport = viewport
      viewport = new Declaration(
        viewport.thisDep,
        viewport.contextDep,
        viewport.propDep,
        function (env, scope) {
          var VIEWPORT = prevViewport.append(env, scope)
          var CONTEXT = env.shared.context
          scope.set(
            CONTEXT,
            '.' + S_VIEWPORT_WIDTH,
            VIEWPORT[2])
          scope.set(
            CONTEXT,
            '.' + S_VIEWPORT_HEIGHT,
            VIEWPORT[3])
          return VIEWPORT
        })
    }

    return {
      viewport: viewport,
      scissor_box: parseBox(S_SCISSOR_BOX)
    }
  }

  function parseAttribLocations (options, attributes) {
    var staticOptions = options.static
    var staticProgram =
      typeof staticOptions[S_FRAG] === 'string' &&
      typeof staticOptions[S_VERT] === 'string'
    if (staticProgram) {
      if (Object.keys(attributes.dynamic).length > 0) {
        return null
      }
      var staticAttributes = attributes.static
      var sAttributes = Object.keys(staticAttributes)
      if (sAttributes.length > 0 && typeof staticAttributes[sAttributes[0]] === 'number') {
        var bindings = []
        for (var i = 0; i < sAttributes.length; ++i) {
          check$1(typeof staticAttributes[sAttributes[i]] === 'number', 'must specify all vertex attribute locations when using vaos')
          bindings.push([staticAttributes[sAttributes[i]] | 0, sAttributes[i]])
        }
        return bindings
      }
    }
    return null
  }

  function parseProgram (options, env, attribLocations) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    function parseShader (name) {
      if (name in staticOptions) {
        var id = stringStore.id(staticOptions[name])
        check$1.optional(function () {
          shaderState.shader(shaderType[name], id, check$1.guessCommand())
        })
        var result = createStaticDecl(function () {
          return id
        })
        result.id = id
        return result
      } else if (name in dynamicOptions) {
        var dyn = dynamicOptions[name]
        return createDynamicDecl(dyn, function (env, scope) {
          var str = env.invoke(scope, dyn)
          var id = scope.def(env.shared.strings, '.id(', str, ')')
          check$1.optional(function () {
            scope(
              env.shared.shader, '.shader(',
              shaderType[name], ',',
              id, ',',
              env.command, ');')
          })
          return id
        })
      }
      return null
    }

    var frag = parseShader(S_FRAG)
    var vert = parseShader(S_VERT)

    var program = null
    var progVar
    if (isStatic(frag) && isStatic(vert)) {
      program = shaderState.program(vert.id, frag.id, null, attribLocations)
      progVar = createStaticDecl(function (env, scope) {
        return env.link(program)
      })
    } else {
      progVar = new Declaration(
        (frag && frag.thisDep) || (vert && vert.thisDep),
        (frag && frag.contextDep) || (vert && vert.contextDep),
        (frag && frag.propDep) || (vert && vert.propDep),
        function (env, scope) {
          var SHADER_STATE = env.shared.shader
          var fragId
          if (frag) {
            fragId = frag.append(env, scope)
          } else {
            fragId = scope.def(SHADER_STATE, '.', S_FRAG)
          }
          var vertId
          if (vert) {
            vertId = vert.append(env, scope)
          } else {
            vertId = scope.def(SHADER_STATE, '.', S_VERT)
          }
          var progDef = SHADER_STATE + '.program(' + vertId + ',' + fragId
          check$1.optional(function () {
            progDef += ',' + env.command
          })
          return scope.def(progDef + ')')
        })
    }

    return {
      frag: frag,
      vert: vert,
      progVar: progVar,
      program: program
    }
  }

  function parseDraw (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    // TODO: should use VAO to get default values for offset properties
    // should move vao parse into here and out of the old stuff

    var staticDraw = {}
    var vaoActive = false

    function parseVAO () {
      if (S_VAO in staticOptions) {
        var vao = staticOptions[S_VAO]
        if (vao !== null && attributeState.getVAO(vao) === null) {
          vao = attributeState.createVAO(vao)
        }

        vaoActive = true
        staticDraw.vao = vao

        return createStaticDecl(function (env) {
          var vaoRef = attributeState.getVAO(vao)
          if (vaoRef) {
            return env.link(vaoRef)
          } else {
            return 'null'
          }
        })
      } else if (S_VAO in dynamicOptions) {
        vaoActive = true
        var dyn = dynamicOptions[S_VAO]
        return createDynamicDecl(dyn, function (env, scope) {
          var vaoRef = env.invoke(scope, dyn)
          return scope.def(env.shared.vao + '.getVAO(' + vaoRef + ')')
        })
      }
      return null
    }

    var vao = parseVAO()

    var elementsActive = false

    function parseElements () {
      if (S_ELEMENTS in staticOptions) {
        var elements = staticOptions[S_ELEMENTS]
        staticDraw.elements = elements
        if (isBufferArgs(elements)) {
          var e = staticDraw.elements = elementState.create(elements, true)
          elements = elementState.getElements(e)
          elementsActive = true
        } else if (elements) {
          elements = elementState.getElements(elements)
          elementsActive = true
          check$1.command(elements, 'invalid elements', env.commandStr)
        }

        var result = createStaticDecl(function (env, scope) {
          if (elements) {
            var result = env.link(elements)
            env.ELEMENTS = result
            return result
          }
          env.ELEMENTS = null
          return null
        })
        result.value = elements
        return result
      } else if (S_ELEMENTS in dynamicOptions) {
        elementsActive = true

        var dyn = dynamicOptions[S_ELEMENTS]
        return createDynamicDecl(dyn, function (env, scope) {
          var shared = env.shared

          var IS_BUFFER_ARGS = shared.isBufferArgs
          var ELEMENT_STATE = shared.elements

          var elementDefn = env.invoke(scope, dyn)
          var elements = scope.def('null')
          var elementStream = scope.def(IS_BUFFER_ARGS, '(', elementDefn, ')')

          var ifte = env.cond(elementStream)
            .then(elements, '=', ELEMENT_STATE, '.createStream(', elementDefn, ');')
            .else(elements, '=', ELEMENT_STATE, '.getElements(', elementDefn, ');')

          check$1.optional(function () {
            env.assert(ifte.else,
              '!' + elementDefn + '||' + elements,
              'invalid elements')
          })

          scope.entry(ifte)
          scope.exit(
            env.cond(elementStream)
              .then(ELEMENT_STATE, '.destroyStream(', elements, ');'))

          env.ELEMENTS = elements

          return elements
        })
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.elements + '.getElements(' + env.shared.vao + '.currentVAO.elements):null')
          })
      }
      return null
    }

    var elements = parseElements()

    function parsePrimitive () {
      if (S_PRIMITIVE in staticOptions) {
        var primitive = staticOptions[S_PRIMITIVE]
        staticDraw.primitive = primitive
        check$1.commandParameter(primitive, primTypes, 'invalid primitve', env.commandStr)
        return createStaticDecl(function (env, scope) {
          return primTypes[primitive]
        })
      } else if (S_PRIMITIVE in dynamicOptions) {
        var dynPrimitive = dynamicOptions[S_PRIMITIVE]
        return createDynamicDecl(dynPrimitive, function (env, scope) {
          var PRIM_TYPES = env.constants.primTypes
          var prim = env.invoke(scope, dynPrimitive)
          check$1.optional(function () {
            env.assert(scope,
              prim + ' in ' + PRIM_TYPES,
              'invalid primitive, must be one of ' + Object.keys(primTypes))
          })
          return scope.def(PRIM_TYPES, '[', prim, ']')
        })
      } else if (elementsActive) {
        if (isStatic(elements)) {
          if (elements.value) {
            return createStaticDecl(function (env, scope) {
              return scope.def(env.ELEMENTS, '.primType')
            })
          } else {
            return createStaticDecl(function () {
              return GL_TRIANGLES$1
            })
          }
        } else {
          return new Declaration(
            elements.thisDep,
            elements.contextDep,
            elements.propDep,
            function (env, scope) {
              var elements = env.ELEMENTS
              return scope.def(elements, '?', elements, '.primType:', GL_TRIANGLES$1)
            })
        }
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.primitive:' + GL_TRIANGLES$1)
          })
      }
      return null
    }

    function parseParam (param, isOffset) {
      if (param in staticOptions) {
        var value = staticOptions[param] | 0
        if (isOffset) {
          staticDraw.offset = value
        } else {
          staticDraw.instances = value
        }
        check$1.command(!isOffset || value >= 0, 'invalid ' + param, env.commandStr)
        return createStaticDecl(function (env, scope) {
          if (isOffset) {
            env.OFFSET = value
          }
          return value
        })
      } else if (param in dynamicOptions) {
        var dynValue = dynamicOptions[param]
        return createDynamicDecl(dynValue, function (env, scope) {
          var result = env.invoke(scope, dynValue)
          if (isOffset) {
            env.OFFSET = result
            check$1.optional(function () {
              env.assert(scope,
                result + '>=0',
                'invalid ' + param)
            })
          }
          return result
        })
      } else if (isOffset) {
        if (elementsActive) {
          return createStaticDecl(function (env, scope) {
            env.OFFSET = 0
            return 0
          })
        } else if (vaoActive) {
          return new Declaration(
            vao.thisDep,
            vao.contextDep,
            vao.propDep,
            function (env, scope) {
              return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.offset:0')
            })
        }
      } else if (vaoActive) {
        return new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao + '.currentVAO?' + env.shared.vao + '.currentVAO.instances:-1')
          })
      }
      return null
    }

    var OFFSET = parseParam(S_OFFSET, true)

    function parseVertCount () {
      if (S_COUNT in staticOptions) {
        var count = staticOptions[S_COUNT] | 0
        staticDraw.count = count
        check$1.command(
          typeof count === 'number' && count >= 0, 'invalid vertex count', env.commandStr)
        return createStaticDecl(function () {
          return count
        })
      } else if (S_COUNT in dynamicOptions) {
        var dynCount = dynamicOptions[S_COUNT]
        return createDynamicDecl(dynCount, function (env, scope) {
          var result = env.invoke(scope, dynCount)
          check$1.optional(function () {
            env.assert(scope,
              'typeof ' + result + '==="number"&&' +
              result + '>=0&&' +
              result + '===(' + result + '|0)',
              'invalid vertex count')
          })
          return result
        })
      } else if (elementsActive) {
        if (isStatic(elements)) {
          if (elements) {
            if (OFFSET) {
              return new Declaration(
                OFFSET.thisDep,
                OFFSET.contextDep,
                OFFSET.propDep,
                function (env, scope) {
                  var result = scope.def(
                    env.ELEMENTS, '.vertCount-', env.OFFSET)

                  check$1.optional(function () {
                    env.assert(scope,
                      result + '>=0',
                      'invalid vertex offset/element buffer too small')
                  })

                  return result
                })
            } else {
              return createStaticDecl(function (env, scope) {
                return scope.def(env.ELEMENTS, '.vertCount')
              })
            }
          } else {
            var result = createStaticDecl(function () {
              return -1
            })
            check$1.optional(function () {
              result.MISSING = true
            })
            return result
          }
        } else {
          var variable = new Declaration(
            elements.thisDep || OFFSET.thisDep,
            elements.contextDep || OFFSET.contextDep,
            elements.propDep || OFFSET.propDep,
            function (env, scope) {
              var elements = env.ELEMENTS
              if (env.OFFSET) {
                return scope.def(elements, '?', elements, '.vertCount-',
                  env.OFFSET, ':-1')
              }
              return scope.def(elements, '?', elements, '.vertCount:-1')
            })
          check$1.optional(function () {
            variable.DYNAMIC = true
          })
          return variable
        }
      } else if (vaoActive) {
        var countVariable = new Declaration(
          vao.thisDep,
          vao.contextDep,
          vao.propDep,
          function (env, scope) {
            return scope.def(env.shared.vao, '.currentVAO?', env.shared.vao, '.currentVAO.count:-1')
          })
        return countVariable
      }
      return null
    }

    var primitive = parsePrimitive()
    var count = parseVertCount()
    var instances = parseParam(S_INSTANCES, false)

    return {
      elements: elements,
      primitive: primitive,
      count: count,
      instances: instances,
      offset: OFFSET,
      vao: vao,

      vaoActive: vaoActive,
      elementsActive: elementsActive,

      // static draw props
      static: staticDraw
    }
  }

  function parseGLState (options, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    var STATE = {}

    GL_STATE_NAMES.forEach(function (prop) {
      var param = propName(prop)

      function parseParam (parseStatic, parseDynamic) {
        if (prop in staticOptions) {
          var value = parseStatic(staticOptions[prop])
          STATE[param] = createStaticDecl(function () {
            return value
          })
        } else if (prop in dynamicOptions) {
          var dyn = dynamicOptions[prop]
          STATE[param] = createDynamicDecl(dyn, function (env, scope) {
            return parseDynamic(env, scope, env.invoke(scope, dyn))
          })
        }
      }

      switch (prop) {
        case S_CULL_ENABLE:
        case S_BLEND_ENABLE:
        case S_DITHER:
        case S_STENCIL_ENABLE:
        case S_DEPTH_ENABLE:
        case S_SCISSOR_ENABLE:
        case S_POLYGON_OFFSET_ENABLE:
        case S_SAMPLE_ALPHA:
        case S_SAMPLE_ENABLE:
        case S_DEPTH_MASK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'boolean', prop, env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="boolean"',
                  'invalid flag ' + prop, env.commandStr)
              })
              return value
            })

        case S_DEPTH_FUNC:
          return parseParam(
            function (value) {
              check$1.commandParameter(value, compareFuncs, 'invalid ' + prop, env.commandStr)
              return compareFuncs[value]
            },
            function (env, scope, value) {
              var COMPARE_FUNCS = env.constants.compareFuncs
              check$1.optional(function () {
                env.assert(scope,
                  value + ' in ' + COMPARE_FUNCS,
                  'invalid ' + prop + ', must be one of ' + Object.keys(compareFuncs))
              })
              return scope.def(COMPARE_FUNCS, '[', value, ']')
            })

        case S_DEPTH_RANGE:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) &&
                value.length === 2 &&
                typeof value[0] === 'number' &&
                typeof value[1] === 'number' &&
                value[0] <= value[1],
                'depth range is 2d array',
                env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===2&&' +
                  'typeof ' + value + '[0]==="number"&&' +
                  'typeof ' + value + '[1]==="number"&&' +
                  value + '[0]<=' + value + '[1]',
                  'depth range must be a 2d array')
              })

              var Z_NEAR = scope.def('+', value, '[0]')
              var Z_FAR = scope.def('+', value, '[1]')
              return [Z_NEAR, Z_FAR]
            })

        case S_BLEND_FUNC:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', 'blend.func', env.commandStr)
              var srcRGB = ('srcRGB' in value ? value.srcRGB : value.src)
              var srcAlpha = ('srcAlpha' in value ? value.srcAlpha : value.src)
              var dstRGB = ('dstRGB' in value ? value.dstRGB : value.dst)
              var dstAlpha = ('dstAlpha' in value ? value.dstAlpha : value.dst)
              check$1.commandParameter(srcRGB, blendFuncs, param + '.srcRGB', env.commandStr)
              check$1.commandParameter(srcAlpha, blendFuncs, param + '.srcAlpha', env.commandStr)
              check$1.commandParameter(dstRGB, blendFuncs, param + '.dstRGB', env.commandStr)
              check$1.commandParameter(dstAlpha, blendFuncs, param + '.dstAlpha', env.commandStr)

              check$1.command(
                (invalidBlendCombinations.indexOf(srcRGB + ', ' + dstRGB) === -1),
                'unallowed blending combination (srcRGB, dstRGB) = (' + srcRGB + ', ' + dstRGB + ')', env.commandStr)

              return [
                blendFuncs[srcRGB],
                blendFuncs[dstRGB],
                blendFuncs[srcAlpha],
                blendFuncs[dstAlpha]
              ]
            },
            function (env, scope, value) {
              var BLEND_FUNCS = env.constants.blendFuncs

              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid blend func, must be an object')
              })

              function read (prefix, suffix) {
                var func = scope.def(
                  '"', prefix, suffix, '" in ', value,
                  '?', value, '.', prefix, suffix,
                  ':', value, '.', prefix)

                check$1.optional(function () {
                  env.assert(scope,
                    func + ' in ' + BLEND_FUNCS,
                    'invalid ' + prop + '.' + prefix + suffix + ', must be one of ' + Object.keys(blendFuncs))
                })

                return func
              }

              var srcRGB = read('src', 'RGB')
              var dstRGB = read('dst', 'RGB')

              check$1.optional(function () {
                var INVALID_BLEND_COMBINATIONS = env.constants.invalidBlendCombinations

                env.assert(scope,
                  INVALID_BLEND_COMBINATIONS +
                           '.indexOf(' + srcRGB + '+", "+' + dstRGB + ') === -1 ',
                  'unallowed blending combination for (srcRGB, dstRGB)'
                )
              })

              var SRC_RGB = scope.def(BLEND_FUNCS, '[', srcRGB, ']')
              var SRC_ALPHA = scope.def(BLEND_FUNCS, '[', read('src', 'Alpha'), ']')
              var DST_RGB = scope.def(BLEND_FUNCS, '[', dstRGB, ']')
              var DST_ALPHA = scope.def(BLEND_FUNCS, '[', read('dst', 'Alpha'), ']')

              return [SRC_RGB, DST_RGB, SRC_ALPHA, DST_ALPHA]
            })

        case S_BLEND_EQUATION:
          return parseParam(
            function (value) {
              if (typeof value === 'string') {
                check$1.commandParameter(value, blendEquations, 'invalid ' + prop, env.commandStr)
                return [
                  blendEquations[value],
                  blendEquations[value]
                ]
              } else if (typeof value === 'object') {
                check$1.commandParameter(
                  value.rgb, blendEquations, prop + '.rgb', env.commandStr)
                check$1.commandParameter(
                  value.alpha, blendEquations, prop + '.alpha', env.commandStr)
                return [
                  blendEquations[value.rgb],
                  blendEquations[value.alpha]
                ]
              } else {
                check$1.commandRaise('invalid blend.equation', env.commandStr)
              }
            },
            function (env, scope, value) {
              var BLEND_EQUATIONS = env.constants.blendEquations

              var RGB = scope.def()
              var ALPHA = scope.def()

              var ifte = env.cond('typeof ', value, '==="string"')

              check$1.optional(function () {
                function checkProp (block, name, value) {
                  env.assert(block,
                    value + ' in ' + BLEND_EQUATIONS,
                    'invalid ' + name + ', must be one of ' + Object.keys(blendEquations))
                }
                checkProp(ifte.then, prop, value)

                env.assert(ifte.else,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
                checkProp(ifte.else, prop + '.rgb', value + '.rgb')
                checkProp(ifte.else, prop + '.alpha', value + '.alpha')
              })

              ifte.then(
                RGB, '=', ALPHA, '=', BLEND_EQUATIONS, '[', value, '];')
              ifte.else(
                RGB, '=', BLEND_EQUATIONS, '[', value, '.rgb];',
                ALPHA, '=', BLEND_EQUATIONS, '[', value, '.alpha];')

              scope(ifte)

              return [RGB, ALPHA]
            })

        case S_BLEND_COLOR:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) &&
                value.length === 4,
                'blend.color must be a 4d array', env.commandStr)
              return loop(4, function (i) {
                return +value[i]
              })
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===4',
                  'blend.color must be a 4d array')
              })
              return loop(4, function (i) {
                return scope.def('+', value, '[', i, ']')
              })
            })

        case S_STENCIL_MASK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'number', param, env.commandStr)
              return value | 0
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="number"',
                  'invalid stencil.mask')
              })
              return scope.def(value, '|0')
            })

        case S_STENCIL_FUNC:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var cmp = value.cmp || 'keep'
              var ref = value.ref || 0
              var mask = 'mask' in value ? value.mask : -1
              check$1.commandParameter(cmp, compareFuncs, prop + '.cmp', env.commandStr)
              check$1.commandType(ref, 'number', prop + '.ref', env.commandStr)
              check$1.commandType(mask, 'number', prop + '.mask', env.commandStr)
              return [
                compareFuncs[cmp],
                ref,
                mask
              ]
            },
            function (env, scope, value) {
              var COMPARE_FUNCS = env.constants.compareFuncs
              check$1.optional(function () {
                function assert () {
                  env.assert(scope,
                    Array.prototype.join.call(arguments, ''),
                    'invalid stencil.func')
                }
                assert(value + '&&typeof ', value, '==="object"')
                assert('!("cmp" in ', value, ')||(',
                  value, '.cmp in ', COMPARE_FUNCS, ')')
              })
              var cmp = scope.def(
                '"cmp" in ', value,
                '?', COMPARE_FUNCS, '[', value, '.cmp]',
                ':', GL_KEEP)
              var ref = scope.def(value, '.ref|0')
              var mask = scope.def(
                '"mask" in ', value,
                '?', value, '.mask|0:-1')
              return [cmp, ref, mask]
            })

        case S_STENCIL_OPFRONT:
        case S_STENCIL_OPBACK:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var fail = value.fail || 'keep'
              var zfail = value.zfail || 'keep'
              var zpass = value.zpass || 'keep'
              check$1.commandParameter(fail, stencilOps, prop + '.fail', env.commandStr)
              check$1.commandParameter(zfail, stencilOps, prop + '.zfail', env.commandStr)
              check$1.commandParameter(zpass, stencilOps, prop + '.zpass', env.commandStr)
              return [
                prop === S_STENCIL_OPBACK ? GL_BACK : GL_FRONT,
                stencilOps[fail],
                stencilOps[zfail],
                stencilOps[zpass]
              ]
            },
            function (env, scope, value) {
              var STENCIL_OPS = env.constants.stencilOps

              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
              })

              function read (name) {
                check$1.optional(function () {
                  env.assert(scope,
                    '!("' + name + '" in ' + value + ')||' +
                    '(' + value + '.' + name + ' in ' + STENCIL_OPS + ')',
                    'invalid ' + prop + '.' + name + ', must be one of ' + Object.keys(stencilOps))
                })

                return scope.def(
                  '"', name, '" in ', value,
                  '?', STENCIL_OPS, '[', value, '.', name, ']:',
                  GL_KEEP)
              }

              return [
                prop === S_STENCIL_OPBACK ? GL_BACK : GL_FRONT,
                read('fail'),
                read('zfail'),
                read('zpass')
              ]
            })

        case S_POLYGON_OFFSET_OFFSET:
          return parseParam(
            function (value) {
              check$1.commandType(value, 'object', param, env.commandStr)
              var factor = value.factor | 0
              var units = value.units | 0
              check$1.commandType(factor, 'number', param + '.factor', env.commandStr)
              check$1.commandType(units, 'number', param + '.units', env.commandStr)
              return [factor, units]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid ' + prop)
              })

              var FACTOR = scope.def(value, '.factor|0')
              var UNITS = scope.def(value, '.units|0')

              return [FACTOR, UNITS]
            })

        case S_CULL_FACE:
          return parseParam(
            function (value) {
              var face = 0
              if (value === 'front') {
                face = GL_FRONT
              } else if (value === 'back') {
                face = GL_BACK
              }
              check$1.command(!!face, param, env.commandStr)
              return face
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '==="front"||' +
                  value + '==="back"',
                  'invalid cull.face')
              })
              return scope.def(value, '==="front"?', GL_FRONT, ':', GL_BACK)
            })

        case S_LINE_WIDTH:
          return parseParam(
            function (value) {
              check$1.command(
                typeof value === 'number' &&
                value >= limits.lineWidthDims[0] &&
                value <= limits.lineWidthDims[1],
                'invalid line width, must be a positive number between ' +
                limits.lineWidthDims[0] + ' and ' + limits.lineWidthDims[1], env.commandStr)
              return value
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  'typeof ' + value + '==="number"&&' +
                  value + '>=' + limits.lineWidthDims[0] + '&&' +
                  value + '<=' + limits.lineWidthDims[1],
                  'invalid line width')
              })

              return value
            })

        case S_FRONT_FACE:
          return parseParam(
            function (value) {
              check$1.commandParameter(value, orientationType, param, env.commandStr)
              return orientationType[value]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '==="cw"||' +
                  value + '==="ccw"',
                  'invalid frontFace, must be one of cw,ccw')
              })
              return scope.def(value + '==="cw"?' + GL_CW + ':' + GL_CCW)
            })

        case S_COLOR_MASK:
          return parseParam(
            function (value) {
              check$1.command(
                isArrayLike(value) && value.length === 4,
                'color.mask must be length 4 array', env.commandStr)
              return value.map(function (v) { return !!v })
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  env.shared.isArrayLike + '(' + value + ')&&' +
                  value + '.length===4',
                  'invalid color.mask')
              })
              return loop(4, function (i) {
                return '!!' + value + '[' + i + ']'
              })
            })

        case S_SAMPLE_COVERAGE:
          return parseParam(
            function (value) {
              check$1.command(typeof value === 'object' && value, param, env.commandStr)
              var sampleValue = 'value' in value ? value.value : 1
              var sampleInvert = !!value.invert
              check$1.command(
                typeof sampleValue === 'number' &&
                sampleValue >= 0 && sampleValue <= 1,
                'sample.coverage.value must be a number between 0 and 1', env.commandStr)
              return [sampleValue, sampleInvert]
            },
            function (env, scope, value) {
              check$1.optional(function () {
                env.assert(scope,
                  value + '&&typeof ' + value + '==="object"',
                  'invalid sample.coverage')
              })
              var VALUE = scope.def(
                '"value" in ', value, '?+', value, '.value:1')
              var INVERT = scope.def('!!', value, '.invert')
              return [VALUE, INVERT]
            })
      }
    })

    return STATE
  }

  function parseUniforms (uniforms, env) {
    var staticUniforms = uniforms.static
    var dynamicUniforms = uniforms.dynamic

    var UNIFORMS = {}

    Object.keys(staticUniforms).forEach(function (name) {
      var value = staticUniforms[name]
      var result
      if (typeof value === 'number' ||
          typeof value === 'boolean') {
        result = createStaticDecl(function () {
          return value
        })
      } else if (typeof value === 'function') {
        var reglType = value._reglType
        if (reglType === 'texture2d' ||
            reglType === 'textureCube') {
          result = createStaticDecl(function (env) {
            return env.link(value)
          })
        } else if (reglType === 'framebuffer' ||
                   reglType === 'framebufferCube') {
          check$1.command(value.color.length > 0,
            'missing color attachment for framebuffer sent to uniform "' + name + '"', env.commandStr)
          result = createStaticDecl(function (env) {
            return env.link(value.color[0])
          })
        } else {
          check$1.commandRaise('invalid data for uniform "' + name + '"', env.commandStr)
        }
      } else if (isArrayLike(value)) {
        result = createStaticDecl(function (env) {
          var ITEM = env.global.def('[',
            loop(value.length, function (i) {
              check$1.command(
                typeof value[i] === 'number' ||
                typeof value[i] === 'boolean',
                'invalid uniform ' + name, env.commandStr)
              return value[i]
            }), ']')
          return ITEM
        })
      } else {
        check$1.commandRaise('invalid or missing data for uniform "' + name + '"', env.commandStr)
      }
      result.value = value
      UNIFORMS[name] = result
    })

    Object.keys(dynamicUniforms).forEach(function (key) {
      var dyn = dynamicUniforms[key]
      UNIFORMS[key] = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    })

    return UNIFORMS
  }

  function parseAttributes (attributes, env) {
    var staticAttributes = attributes.static
    var dynamicAttributes = attributes.dynamic

    var attributeDefs = {}

    Object.keys(staticAttributes).forEach(function (attribute) {
      var value = staticAttributes[attribute]
      var id = stringStore.id(attribute)

      var record = new AttributeRecord()
      if (isBufferArgs(value)) {
        record.state = ATTRIB_STATE_POINTER
        record.buffer = bufferState.getBuffer(
          bufferState.create(value, GL_ARRAY_BUFFER$2, false, true))
        record.type = 0
      } else {
        var buffer = bufferState.getBuffer(value)
        if (buffer) {
          record.state = ATTRIB_STATE_POINTER
          record.buffer = buffer
          record.type = 0
        } else {
          check$1.command(typeof value === 'object' && value,
            'invalid data for attribute ' + attribute, env.commandStr)
          if ('constant' in value) {
            var constant = value.constant
            record.buffer = 'null'
            record.state = ATTRIB_STATE_CONSTANT
            if (typeof constant === 'number') {
              record.x = constant
            } else {
              check$1.command(
                isArrayLike(constant) &&
                constant.length > 0 &&
                constant.length <= 4,
                'invalid constant for attribute ' + attribute, env.commandStr)
              CUTE_COMPONENTS.forEach(function (c, i) {
                if (i < constant.length) {
                  record[c] = constant[i]
                }
              })
            }
          } else {
            if (isBufferArgs(value.buffer)) {
              buffer = bufferState.getBuffer(
                bufferState.create(value.buffer, GL_ARRAY_BUFFER$2, false, true))
            } else {
              buffer = bufferState.getBuffer(value.buffer)
            }
            check$1.command(!!buffer, 'missing buffer for attribute "' + attribute + '"', env.commandStr)

            var offset = value.offset | 0
            check$1.command(offset >= 0,
              'invalid offset for attribute "' + attribute + '"', env.commandStr)

            var stride = value.stride | 0
            check$1.command(stride >= 0 && stride < 256,
              'invalid stride for attribute "' + attribute + '", must be integer betweeen [0, 255]', env.commandStr)

            var size = value.size | 0
            check$1.command(!('size' in value) || (size > 0 && size <= 4),
              'invalid size for attribute "' + attribute + '", must be 1,2,3,4', env.commandStr)

            var normalized = !!value.normalized

            var type = 0
            if ('type' in value) {
              check$1.commandParameter(
                value.type, glTypes,
                'invalid type for attribute ' + attribute, env.commandStr)
              type = glTypes[value.type]
            }

            var divisor = value.divisor | 0
            check$1.optional(function () {
              if ('divisor' in value) {
                check$1.command(divisor === 0 || extInstancing,
                  'cannot specify divisor for attribute "' + attribute + '", instancing not supported', env.commandStr)
                check$1.command(divisor >= 0,
                  'invalid divisor for attribute "' + attribute + '"', env.commandStr)
              }

              var command = env.commandStr

              var VALID_KEYS = [
                'buffer',
                'offset',
                'divisor',
                'normalized',
                'type',
                'size',
                'stride'
              ]

              Object.keys(value).forEach(function (prop) {
                check$1.command(
                  VALID_KEYS.indexOf(prop) >= 0,
                  'unknown parameter "' + prop + '" for attribute pointer "' + attribute + '" (valid parameters are ' + VALID_KEYS + ')',
                  command)
              })
            })

            record.buffer = buffer
            record.state = ATTRIB_STATE_POINTER
            record.size = size
            record.normalized = normalized
            record.type = type || buffer.dtype
            record.offset = offset
            record.stride = stride
            record.divisor = divisor
          }
        }
      }

      attributeDefs[attribute] = createStaticDecl(function (env, scope) {
        var cache = env.attribCache
        if (id in cache) {
          return cache[id]
        }
        var result = {
          isStream: false
        }
        Object.keys(record).forEach(function (key) {
          result[key] = record[key]
        })
        if (record.buffer) {
          result.buffer = env.link(record.buffer)
          result.type = result.type || (result.buffer + '.dtype')
        }
        cache[id] = result
        return result
      })
    })

    Object.keys(dynamicAttributes).forEach(function (attribute) {
      var dyn = dynamicAttributes[attribute]

      function appendAttributeCode (env, block) {
        var VALUE = env.invoke(block, dyn)

        var shared = env.shared
        var constants = env.constants

        var IS_BUFFER_ARGS = shared.isBufferArgs
        var BUFFER_STATE = shared.buffer

        // Perform validation on attribute
        check$1.optional(function () {
          env.assert(block,
            VALUE + '&&(typeof ' + VALUE + '==="object"||typeof ' +
            VALUE + '==="function")&&(' +
            IS_BUFFER_ARGS + '(' + VALUE + ')||' +
            BUFFER_STATE + '.getBuffer(' + VALUE + ')||' +
            BUFFER_STATE + '.getBuffer(' + VALUE + '.buffer)||' +
            IS_BUFFER_ARGS + '(' + VALUE + '.buffer)||' +
            '("constant" in ' + VALUE +
            '&&(typeof ' + VALUE + '.constant==="number"||' +
            shared.isArrayLike + '(' + VALUE + '.constant))))',
            'invalid dynamic attribute "' + attribute + '"')
        })

        // allocate names for result
        var result = {
          isStream: block.def(false)
        }
        var defaultRecord = new AttributeRecord()
        defaultRecord.state = ATTRIB_STATE_POINTER
        Object.keys(defaultRecord).forEach(function (key) {
          result[key] = block.def('' + defaultRecord[key])
        })

        var BUFFER = result.buffer
        var TYPE = result.type
        block(
          'if(', IS_BUFFER_ARGS, '(', VALUE, ')){',
          result.isStream, '=true;',
          BUFFER, '=', BUFFER_STATE, '.createStream(', GL_ARRAY_BUFFER$2, ',', VALUE, ');',
          TYPE, '=', BUFFER, '.dtype;',
          '}else{',
          BUFFER, '=', BUFFER_STATE, '.getBuffer(', VALUE, ');',
          'if(', BUFFER, '){',
          TYPE, '=', BUFFER, '.dtype;',
          '}else if("constant" in ', VALUE, '){',
          result.state, '=', ATTRIB_STATE_CONSTANT, ';',
          'if(typeof ' + VALUE + '.constant === "number"){',
          result[CUTE_COMPONENTS[0]], '=', VALUE, '.constant;',
          CUTE_COMPONENTS.slice(1).map(function (n) {
            return result[n]
          }).join('='), '=0;',
          '}else{',
          CUTE_COMPONENTS.map(function (name, i) {
            return (
              result[name] + '=' + VALUE + '.constant.length>' + i +
              '?' + VALUE + '.constant[' + i + ']:0;'
            )
          }).join(''),
          '}}else{',
          'if(', IS_BUFFER_ARGS, '(', VALUE, '.buffer)){',
          BUFFER, '=', BUFFER_STATE, '.createStream(', GL_ARRAY_BUFFER$2, ',', VALUE, '.buffer);',
          '}else{',
          BUFFER, '=', BUFFER_STATE, '.getBuffer(', VALUE, '.buffer);',
          '}',
          TYPE, '="type" in ', VALUE, '?',
          constants.glTypes, '[', VALUE, '.type]:', BUFFER, '.dtype;',
          result.normalized, '=!!', VALUE, '.normalized;')
        function emitReadRecord (name) {
          block(result[name], '=', VALUE, '.', name, '|0;')
        }
        emitReadRecord('size')
        emitReadRecord('offset')
        emitReadRecord('stride')
        emitReadRecord('divisor')

        block('}}')

        block.exit(
          'if(', result.isStream, '){',
          BUFFER_STATE, '.destroyStream(', BUFFER, ');',
          '}')

        return result
      }

      attributeDefs[attribute] = createDynamicDecl(dyn, appendAttributeCode)
    })

    return attributeDefs
  }

  function parseContext (context) {
    var staticContext = context.static
    var dynamicContext = context.dynamic
    var result = {}

    Object.keys(staticContext).forEach(function (name) {
      var value = staticContext[name]
      result[name] = createStaticDecl(function (env, scope) {
        if (typeof value === 'number' || typeof value === 'boolean') {
          return '' + value
        } else {
          return env.link(value)
        }
      })
    })

    Object.keys(dynamicContext).forEach(function (name) {
      var dyn = dynamicContext[name]
      result[name] = createDynamicDecl(dyn, function (env, scope) {
        return env.invoke(scope, dyn)
      })
    })

    return result
  }

  function parseArguments (options, attributes, uniforms, context, env) {
    var staticOptions = options.static
    var dynamicOptions = options.dynamic

    check$1.optional(function () {
      var KEY_NAMES = [
        S_FRAMEBUFFER,
        S_VERT,
        S_FRAG,
        S_ELEMENTS,
        S_PRIMITIVE,
        S_OFFSET,
        S_COUNT,
        S_INSTANCES,
        S_PROFILE,
        S_VAO
      ].concat(GL_STATE_NAMES)

      function checkKeys (dict) {
        Object.keys(dict).forEach(function (key) {
          check$1.command(
            KEY_NAMES.indexOf(key) >= 0,
            'unknown parameter "' + key + '"',
            env.commandStr)
        })
      }

      checkKeys(staticOptions)
      checkKeys(dynamicOptions)
    })

    var attribLocations = parseAttribLocations(options, attributes)

    var framebuffer = parseFramebuffer(options, env)
    var viewportAndScissor = parseViewportScissor(options, framebuffer, env)
    var draw = parseDraw(options, env)
    var state = parseGLState(options, env)
    var shader = parseProgram(options, env, attribLocations)

    function copyBox (name) {
      var defn = viewportAndScissor[name]
      if (defn) {
        state[name] = defn
      }
    }
    copyBox(S_VIEWPORT)
    copyBox(propName(S_SCISSOR_BOX))

    var dirty = Object.keys(state).length > 0

    var result = {
      framebuffer: framebuffer,
      draw: draw,
      shader: shader,
      state: state,
      dirty: dirty,
      scopeVAO: null,
      drawVAO: null,
      useVAO: false,
      attributes: {}
    }

    result.profile = parseProfile(options, env)
    result.uniforms = parseUniforms(uniforms, env)
    result.drawVAO = result.scopeVAO = draw.vao
    // special case: check if we can statically allocate a vertex array object for this program
    if (!result.drawVAO &&
      shader.program &&
      !attribLocations &&
      extensions.angle_instanced_arrays &&
      draw.static.elements) {
      var useVAO = true
      var staticBindings = shader.program.attributes.map(function (attr) {
        var binding = attributes.static[attr]
        useVAO = useVAO && !!binding
        return binding
      })
      if (useVAO && staticBindings.length > 0) {
        var vao = attributeState.getVAO(attributeState.createVAO({
          attributes: staticBindings,
          elements: draw.static.elements
        }))
        result.drawVAO = new Declaration(null, null, null, function (env, scope) {
          return env.link(vao)
        })
        result.useVAO = true
      }
    }
    if (attribLocations) {
      result.useVAO = true
    } else {
      result.attributes = parseAttributes(attributes, env)
    }
    result.context = parseContext(context, env)
    return result
  }

  // ===================================================
  // ===================================================
  // COMMON UPDATE FUNCTIONS
  // ===================================================
  // ===================================================
  function emitContext (env, scope, context) {
    var shared = env.shared
    var CONTEXT = shared.context

    var contextEnter = env.scope()

    Object.keys(context).forEach(function (name) {
      scope.save(CONTEXT, '.' + name)
      var defn = context[name]
      var value = defn.append(env, scope)
      if (Array.isArray(value)) {
        contextEnter(CONTEXT, '.', name, '=[', value.join(), '];')
      } else {
        contextEnter(CONTEXT, '.', name, '=', value, ';')
      }
    })

    scope(contextEnter)
  }

  // ===================================================
  // ===================================================
  // COMMON DRAWING FUNCTIONS
  // ===================================================
  // ===================================================
  function emitPollFramebuffer (env, scope, framebuffer, skipCheck) {
    var shared = env.shared

    var GL = shared.gl
    var FRAMEBUFFER_STATE = shared.framebuffer
    var EXT_DRAW_BUFFERS
    if (extDrawBuffers) {
      EXT_DRAW_BUFFERS = scope.def(shared.extensions, '.webgl_draw_buffers')
    }

    var constants = env.constants

    var DRAW_BUFFERS = constants.drawBuffer
    var BACK_BUFFER = constants.backBuffer

    var NEXT
    if (framebuffer) {
      NEXT = framebuffer.append(env, scope)
    } else {
      NEXT = scope.def(FRAMEBUFFER_STATE, '.next')
    }

    if (!skipCheck) {
      scope('if(', NEXT, '!==', FRAMEBUFFER_STATE, '.cur){')
    }
    scope(
      'if(', NEXT, '){',
      GL, '.bindFramebuffer(', GL_FRAMEBUFFER$2, ',', NEXT, '.framebuffer);')
    if (extDrawBuffers) {
      scope(EXT_DRAW_BUFFERS, '.drawBuffersWEBGL(',
        DRAW_BUFFERS, '[', NEXT, '.colorAttachments.length]);')
    }
    scope('}else{',
      GL, '.bindFramebuffer(', GL_FRAMEBUFFER$2, ',null);')
    if (extDrawBuffers) {
      scope(EXT_DRAW_BUFFERS, '.drawBuffersWEBGL(', BACK_BUFFER, ');')
    }
    scope(
      '}',
      FRAMEBUFFER_STATE, '.cur=', NEXT, ';')
    if (!skipCheck) {
      scope('}')
    }
  }

  function emitPollState (env, scope, args) {
    var shared = env.shared

    var GL = shared.gl

    var CURRENT_VARS = env.current
    var NEXT_VARS = env.next
    var CURRENT_STATE = shared.current
    var NEXT_STATE = shared.next

    var block = env.cond(CURRENT_STATE, '.dirty')

    GL_STATE_NAMES.forEach(function (prop) {
      var param = propName(prop)
      if (param in args.state) {
        return
      }

      var NEXT, CURRENT
      if (param in NEXT_VARS) {
        NEXT = NEXT_VARS[param]
        CURRENT = CURRENT_VARS[param]
        var parts = loop(currentState[param].length, function (i) {
          return block.def(NEXT, '[', i, ']')
        })
        block(env.cond(parts.map(function (p, i) {
          return p + '!==' + CURRENT + '[' + i + ']'
        }).join('||'))
          .then(
            GL, '.', GL_VARIABLES[param], '(', parts, ');',
            parts.map(function (p, i) {
              return CURRENT + '[' + i + ']=' + p
            }).join(';'), ';'))
      } else {
        NEXT = block.def(NEXT_STATE, '.', param)
        var ifte = env.cond(NEXT, '!==', CURRENT_STATE, '.', param)
        block(ifte)
        if (param in GL_FLAGS) {
          ifte(
            env.cond(NEXT)
              .then(GL, '.enable(', GL_FLAGS[param], ');')
              .else(GL, '.disable(', GL_FLAGS[param], ');'),
            CURRENT_STATE, '.', param, '=', NEXT, ';')
        } else {
          ifte(
            GL, '.', GL_VARIABLES[param], '(', NEXT, ');',
            CURRENT_STATE, '.', param, '=', NEXT, ';')
        }
      }
    })
    if (Object.keys(args.state).length === 0) {
      block(CURRENT_STATE, '.dirty=false;')
    }
    scope(block)
  }

  function emitSetOptions (env, scope, options, filter) {
    var shared = env.shared
    var CURRENT_VARS = env.current
    var CURRENT_STATE = shared.current
    var GL = shared.gl
    sortState(Object.keys(options)).forEach(function (param) {
      var defn = options[param]
      if (filter && !filter(defn)) {
        return
      }
      var variable = defn.append(env, scope)
      if (GL_FLAGS[param]) {
        var flag = GL_FLAGS[param]
        if (isStatic(defn)) {
          scope(env.cond(env.stableRef(variable))
            .then(GL, '.enable(', flag, ');')
            .else(GL, '.disable(', flag, ');'))
          scope(CURRENT_STATE, '.', param, '=', env.stableRef(variable), ';')
        } else {
          scope(env.cond(variable)
            .then(GL, '.enable(', flag, ');')
            .else(GL, '.disable(', flag, ');'))
            scope(CURRENT_STATE, '.', param, '=', variable, ';')
        }
      } else if (isArrayLike(variable)) {
        var CURRENT = CURRENT_VARS[param]
        scope(
          GL, '.', GL_VARIABLES[param], '(', variable, ');',
          variable.map(function (v, i) {
            return CURRENT + '[' + i + ']=' + v
          }).join(';'), ';')
      } else {
        scope(
          GL, '.', GL_VARIABLES[param], '(', env.stableRef(variable), ');',
          CURRENT_STATE, '.', param, '=', env.stableRef(variable), ';')
      }
    })
  }

  function injectExtensions (env, scope) {
    if (extInstancing) {
      env.instancing = scope.def(
        env.shared.extensions, '.angle_instanced_arrays')
    }
  }

  function emitProfile (env, scope, args, useScope, incrementCounter) {
    var shared = env.shared
    var STATS = env.stats
    var CURRENT_STATE = shared.current
    var TIMER = shared.timer
    var profileArg = args.profile

    function perfCounter () {
      if (typeof performance === 'undefined') {
        return 'Date.now()'
      } else {
        return 'performance.now()'
      }
    }

    var CPU_START, QUERY_COUNTER
    function emitProfileStart (block) {
      CPU_START = scope.def()
      block(CPU_START, '=', perfCounter(), ';')
      if (typeof incrementCounter === 'string') {
        block(STATS, '.count+=', incrementCounter, ';')
      } else {
        block(STATS, '.count++;')
      }
      if (timer) {
        if (useScope) {
          QUERY_COUNTER = scope.def()
          block(QUERY_COUNTER, '=', TIMER, '.getNumPendingQueries();')
        } else {
          block(TIMER, '.beginQuery(', STATS, ');')
        }
      }
    }

    function emitProfileEnd (block) {
      block(STATS, '.cpuTime+=', perfCounter(), '-', CPU_START, ';')
      if (timer) {
        if (useScope) {
          block(TIMER, '.pushScopeStats(',
            QUERY_COUNTER, ',',
            TIMER, '.getNumPendingQueries(),',
            STATS, ');')
        } else {
          block(TIMER, '.endQuery();')
        }
      }
    }

    function scopeProfile (value) {
      var prev = scope.def(CURRENT_STATE, '.profile')
      scope(CURRENT_STATE, '.profile=', value, ';')
      scope.exit(CURRENT_STATE, '.profile=', prev, ';')
    }

    var USE_PROFILE
    if (profileArg) {
      if (isStatic(profileArg)) {
        if (profileArg.enable) {
          emitProfileStart(scope)
          emitProfileEnd(scope.exit)
          scopeProfile('true')
        } else {
          scopeProfile('false')
        }
        return
      }
      USE_PROFILE = profileArg.append(env, scope)
      scopeProfile(USE_PROFILE)
    } else {
      USE_PROFILE = scope.def(CURRENT_STATE, '.profile')
    }

    var start = env.block()
    emitProfileStart(start)
    scope('if(', USE_PROFILE, '){', start, '}')
    var end = env.block()
    emitProfileEnd(end)
    scope.exit('if(', USE_PROFILE, '){', end, '}')
  }

  function emitAttributes (env, scope, args, attributes, filter) {
    var shared = env.shared

    function typeLength (x) {
      switch (x) {
        case GL_FLOAT_VEC2:
        case GL_INT_VEC2:
        case GL_BOOL_VEC2:
          return 2
        case GL_FLOAT_VEC3:
        case GL_INT_VEC3:
        case GL_BOOL_VEC3:
          return 3
        case GL_FLOAT_VEC4:
        case GL_INT_VEC4:
        case GL_BOOL_VEC4:
          return 4
        default:
          return 1
      }
    }

    function emitBindAttribute (ATTRIBUTE, size, record) {
      var GL = shared.gl

      var LOCATION = scope.def(ATTRIBUTE, '.location')
      var BINDING = scope.def(shared.attributes, '[', LOCATION, ']')

      var STATE = record.state
      var BUFFER = record.buffer
      var CONST_COMPONENTS = [
        record.x,
        record.y,
        record.z,
        record.w
      ]

      var COMMON_KEYS = [
        'buffer',
        'normalized',
        'offset',
        'stride'
      ]

      function emitBuffer () {
        scope(
          'if(!', BINDING, '.buffer){',
          GL, '.enableVertexAttribArray(', LOCATION, ');}')

        var TYPE = record.type
        var SIZE
        if (!record.size) {
          SIZE = size
        } else {
          SIZE = scope.def(record.size, '||', size)
        }

        scope('if(',
          BINDING, '.type!==', TYPE, '||',
          BINDING, '.size!==', SIZE, '||',
          COMMON_KEYS.map(function (key) {
            return BINDING + '.' + key + '!==' + record[key]
          }).join('||'),
          '){',
          GL, '.bindBuffer(', GL_ARRAY_BUFFER$2, ',', BUFFER, '.buffer);',
          GL, '.vertexAttribPointer(', [
            LOCATION,
            SIZE,
            TYPE,
            record.normalized,
            record.stride,
            record.offset
          ], ');',
          BINDING, '.type=', TYPE, ';',
          BINDING, '.size=', SIZE, ';',
          COMMON_KEYS.map(function (key) {
            return BINDING + '.' + key + '=' + record[key] + ';'
          }).join(''),
          '}')

        if (extInstancing) {
          var DIVISOR = record.divisor
          scope(
            'if(', BINDING, '.divisor!==', DIVISOR, '){',
            env.instancing, '.vertexAttribDivisorANGLE(', [LOCATION, DIVISOR], ');',
            BINDING, '.divisor=', DIVISOR, ';}')
        }
      }

      function emitConstant () {
        scope(
          'if(', BINDING, '.buffer){',
          GL, '.disableVertexAttribArray(', LOCATION, ');',
          BINDING, '.buffer=null;',
          '}if(', CUTE_COMPONENTS.map(function (c, i) {
            return BINDING + '.' + c + '!==' + CONST_COMPONENTS[i]
          }).join('||'), '){',
          GL, '.vertexAttrib4f(', LOCATION, ',', CONST_COMPONENTS, ');',
          CUTE_COMPONENTS.map(function (c, i) {
            return BINDING + '.' + c + '=' + CONST_COMPONENTS[i] + ';'
          }).join(''),
          '}')
      }

      if (STATE === ATTRIB_STATE_POINTER) {
        emitBuffer()
      } else if (STATE === ATTRIB_STATE_CONSTANT) {
        emitConstant()
      } else {
        scope('if(', STATE, '===', ATTRIB_STATE_POINTER, '){')
        emitBuffer()
        scope('}else{')
        emitConstant()
        scope('}')
      }
    }

//     scope(`
// /*
// Emitting attributes:
// ${JSON.stringify(attributes, getCircularReplacer(), 2)}
// */
//     `)

    attributes.forEach(function (attribute) {
      var name = attribute.name
      var arg = args.attributes[name]
      var record
      if (arg) {
        if (!filter(arg)) {
          return
        }
        record = arg.append(env, scope)
      } else {
        if (!filter(SCOPE_DECL)) {
          return
        }
        var scopeAttrib = env.scopeAttrib(name)
        check$1.optional(function () {
          env.assert(scope,
            scopeAttrib + '.state',
            'missing attribute ' + name)
        })
        record = {}
        Object.keys(new AttributeRecord()).forEach(function (key) {
          record[key] = scope.def(scopeAttrib, '.', key)
        })
      }
      emitBindAttribute(
        env.link(attribute), typeLength(attribute.info.type), record)
    })
  }

  function emitUniforms (env, scope, args, uniforms, filter, isBatchInnerLoop) {
    var shared = env.shared
    var GL = shared.gl

//     scope(`
// /*
// Emitting uniforms :
// ${JSON.stringify(uniforms, getCircularReplacer(), 2)}
// */
// `)
    var infix
    for (var i = 0; i < uniforms.length; ++i) {
      var uniform = uniforms[i]
      var name = uniform.name
      var type = uniform.info.type
      var arg = args.uniforms[name]
      var UNIFORM = env.link(uniform)
      var LOCATION = UNIFORM + '.location'

      var VALUE
      if (arg) {
        if (!filter(arg)) {
          continue
        }
        if (isStatic(arg)) {
          var value = arg.value
          check$1.command(
            value !== null && typeof value !== 'undefined',
            'missing uniform "' + name + '"', env.commandStr)
          if (type === GL_SAMPLER_2D || type === GL_SAMPLER_CUBE) {
            check$1.command(
              typeof value === 'function' &&
              ((type === GL_SAMPLER_2D &&
                (value._reglType === 'texture2d' ||
                value._reglType === 'framebuffer')) ||
              (type === GL_SAMPLER_CUBE &&
                (value._reglType === 'textureCube' ||
                value._reglType === 'framebufferCube'))),
              'invalid texture for uniform ' + name, env.commandStr)
            var TEX_VALUE = env.link(value._texture || value.color[0]._texture)
            scope(GL, '.uniform1i(', LOCATION, ',', TEX_VALUE + '.bind());')
            scope.exit(TEX_VALUE, '.unbind();')
          } else if (
            type === GL_FLOAT_MAT2 ||
            type === GL_FLOAT_MAT3 ||
            type === GL_FLOAT_MAT4) {
            check$1.optional(function () {
              check$1.command(isArrayLike(value),
                'invalid matrix for uniform ' + name, env.commandStr)
              check$1.command(
                (type === GL_FLOAT_MAT2 && value.length === 4) ||
                (type === GL_FLOAT_MAT3 && value.length === 9) ||
                (type === GL_FLOAT_MAT4 && value.length === 16),
                'invalid length for matrix uniform ' + name, env.commandStr)
            })
            var MAT_VALUE = env.global.def('new Float32Array([' +
              Array.prototype.slice.call(value) + '])')
            var dim = 2
            if (type === GL_FLOAT_MAT3) {
              dim = 3
            } else if (type === GL_FLOAT_MAT4) {
              dim = 4
            }
            scope(
              GL, '.uniformMatrix', dim, 'fv(',
              LOCATION, ',false,', MAT_VALUE, ');')
          } else {
            switch (type) {
              case GL_FLOAT$8:
                check$1.commandType(value, 'number', 'uniform ' + name, env.commandStr)
                infix = '1f'
                break
              case GL_FLOAT_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2f'
                break
              case GL_FLOAT_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3f'
                break
              case GL_FLOAT_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4f'
                break
              case GL_BOOL:
                check$1.commandType(value, 'boolean', 'uniform ' + name, env.commandStr)
                infix = '1i'
                break
              case GL_INT$3:
                check$1.commandType(value, 'number', 'uniform ' + name, env.commandStr)
                infix = '1i'
                break
              case GL_BOOL_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2i'
                break
              case GL_INT_VEC2:
                check$1.command(
                  isArrayLike(value) && value.length === 2,
                  'uniform ' + name, env.commandStr)
                infix = '2i'
                break
              case GL_BOOL_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3i'
                break
              case GL_INT_VEC3:
                check$1.command(
                  isArrayLike(value) && value.length === 3,
                  'uniform ' + name, env.commandStr)
                infix = '3i'
                break
              case GL_BOOL_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4i'
                break
              case GL_INT_VEC4:
                check$1.command(
                  isArrayLike(value) && value.length === 4,
                  'uniform ' + name, env.commandStr)
                infix = '4i'
                break
            }
            scope(GL, '.uniform', infix, '(', LOCATION, ',',
              isArrayLike(value) ? Array.prototype.slice.call(value) : value,
              ');')
          }
          continue
        } else {
          VALUE = arg.append(env, scope)
        }
      } else {
        if (!filter(SCOPE_DECL)) {
          continue
        }
        VALUE = scope.def(shared.uniforms, '[', stringStore.id(name), ']')
      }

      if (type === GL_SAMPLER_2D) {
        check$1(!Array.isArray(VALUE), 'must specify a scalar prop for textures')
        scope(
          'if(', VALUE, '&&', VALUE, '._reglType==="framebuffer"){',
          VALUE, '=', VALUE, '.color[0];',
          '}')
      } else if (type === GL_SAMPLER_CUBE) {
        check$1(!Array.isArray(VALUE), 'must specify a scalar prop for cube maps')
        scope(
          'if(', VALUE, '&&', VALUE, '._reglType==="framebufferCube"){',
          VALUE, '=', VALUE, '.color[0];',
          '}')
      }

      // perform type validation
      check$1.optional(function () {
        function emitCheck (pred, message) {
          env.assert(scope, pred,
            'bad data or missing for uniform "' + name + '".  ' + message)
        }

        function checkType (type) {
          check$1(!Array.isArray(VALUE), 'must not specify an array type for uniform')
          emitCheck(
            'typeof ' + VALUE + '==="' + type + '"',
            'invalid type, expected ' + type)
        }

        function checkVector (n, type) {
          if (Array.isArray(VALUE)) {
            check$1(VALUE.length === n, 'must have length ' + n)
          } else {
            emitCheck(
              shared.isArrayLike + '(' + VALUE + ')&&' + VALUE + '.length===' + n,
              'invalid vector, should have length ' + n, env.commandStr)
          }
        }

        function checkTexture (target) {
          check$1(!Array.isArray(VALUE), 'must not specify a value type')
          emitCheck(
            'typeof ' + VALUE + '==="function"&&' +
            VALUE + '._reglType==="texture' +
            (target === GL_TEXTURE_2D$3 ? '2d' : 'Cube') + '"',
            'invalid texture type', env.commandStr)
        }

        switch (type) {
          case GL_INT$3:
            checkType('number')
            break
          case GL_INT_VEC2:
            checkVector(2, 'number')
            break
          case GL_INT_VEC3:
            checkVector(3, 'number')
            break
          case GL_INT_VEC4:
            checkVector(4, 'number')
            break
          case GL_FLOAT$8:
            checkType('number')
            break
          case GL_FLOAT_VEC2:
            checkVector(2, 'number')
            break
          case GL_FLOAT_VEC3:
            checkVector(3, 'number')
            break
          case GL_FLOAT_VEC4:
            checkVector(4, 'number')
            break
          case GL_BOOL:
            checkType('boolean')
            break
          case GL_BOOL_VEC2:
            checkVector(2, 'boolean')
            break
          case GL_BOOL_VEC3:
            checkVector(3, 'boolean')
            break
          case GL_BOOL_VEC4:
            checkVector(4, 'boolean')
            break
          case GL_FLOAT_MAT2:
            checkVector(4, 'number')
            break
          case GL_FLOAT_MAT3:
            checkVector(9, 'number')
            break
          case GL_FLOAT_MAT4:
            checkVector(16, 'number')
            break
          case GL_SAMPLER_2D:
            checkTexture(GL_TEXTURE_2D$3)
            break
          case GL_SAMPLER_CUBE:
            checkTexture(GL_TEXTURE_CUBE_MAP$2)
            break
        }
      })

      var unroll = 1
      switch (type) {
        case GL_SAMPLER_2D:
        case GL_SAMPLER_CUBE:
          var TEX = scope.def(VALUE, '._texture')
          scope(GL, '.uniform1i(', LOCATION, ',', TEX, '.bind());')
          scope.exit(TEX, '.unbind();')
          continue

        case GL_INT$3:
        case GL_BOOL:
          infix = '1i'
          break

        case GL_INT_VEC2:
        case GL_BOOL_VEC2:
          infix = '2i'
          unroll = 2
          break

        case GL_INT_VEC3:
        case GL_BOOL_VEC3:
          infix = '3i'
          unroll = 3
          break

        case GL_INT_VEC4:
        case GL_BOOL_VEC4:
          infix = '4i'
          unroll = 4
          break

        case GL_FLOAT$8:
          infix = '1f'
          break

        case GL_FLOAT_VEC2:
          infix = '2f'
          unroll = 2
          break

        case GL_FLOAT_VEC3:
          infix = '3f'
          unroll = 3
          break

        case GL_FLOAT_VEC4:
          infix = '4f'
          unroll = 4
          break

        case GL_FLOAT_MAT2:
          infix = 'Matrix2fv'
          break

        case GL_FLOAT_MAT3:
          infix = 'Matrix3fv'
          break

        case GL_FLOAT_MAT4:
          infix = 'Matrix4fv'
          break
      }

      if (infix.charAt(0) === 'M') {
        scope(GL, '.uniform', infix, '(', LOCATION, ',')
        var matSize = Math.pow(type - GL_FLOAT_MAT2 + 2, 2)
        var STORAGE = env.global.def('new Float32Array(', matSize, ')')
        if (Array.isArray(VALUE)) {
          scope(
            'false,(',
            loop(matSize, function (i) {
              return STORAGE + '[' + i + ']=' + VALUE[i]
            }), ',', STORAGE, ')')
        } else {
          scope(
            'false,(Array.isArray(', VALUE, ')||', VALUE, ' instanceof Float32Array)?', VALUE, ':(',
            loop(matSize, function (i) {
              return STORAGE + '[' + i + ']=' + VALUE + '[' + i + ']'
            }), ',', STORAGE, ')')
        }
        scope(');')
      } else if (unroll > 1) {
        var prev = []
        var cur = []
        for (var j = 0; j < unroll; ++j) {
          if (Array.isArray(VALUE)) {
            cur.push(VALUE[j])
          } else {
            cur.push(scope.def(VALUE + '[' + j + ']'))
          }
          if (isBatchInnerLoop) {
            prev.push(scope.def())
          }
        }
        if (isBatchInnerLoop) {
          scope('if(!', env.batchId, '||', prev.map(function (p, i) {
            return p + '!==' + cur[i]
          }).join('||'), '){', prev.map(function (p, i) {
            return p + '=' + cur[i] + ';'
          }).join(''))
        }
        scope(GL, '.uniform', infix, '(', LOCATION, ',', cur.join(','), ');')
        if (isBatchInnerLoop) {
          scope('}')
        }
      } else {
        check$1(!Array.isArray(VALUE), 'uniform value must not be an array')
        if (isBatchInnerLoop) {
          var prevS = scope.def()
          scope('if(!', env.batchId, '||', prevS, '!==', VALUE, '){',
            prevS, '=', VALUE, ';')
        }
        scope(GL, '.uniform', infix, '(', LOCATION, ',', VALUE, ');')
        if (isBatchInnerLoop) {
          scope('}')
        }
      }
    }
  }

  function emitDraw (env, outer, inner, args) {
    var shared = env.shared
    var GL = shared.gl
    var DRAW_STATE = shared.draw

    var drawOptions = args.draw

    function emitElements () {
      var defn = drawOptions.elements
      var ELEMENTS
      var scope = outer
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          scope = inner
        }
        ELEMENTS = defn.append(env, scope)
        if (drawOptions.elementsActive) {
          scope(
            'if(' + ELEMENTS + ')' +
            GL + '.bindBuffer(' + GL_ELEMENT_ARRAY_BUFFER$2 + ',' + ELEMENTS + '.buffer.buffer);')
        }
      } else {
        ELEMENTS = scope.def()
        scope(
          ELEMENTS, '=', DRAW_STATE, '.', S_ELEMENTS, ';',
          'if(', ELEMENTS, '){',
          GL, '.bindBuffer(', GL_ELEMENT_ARRAY_BUFFER$2, ',', ELEMENTS, '.buffer.buffer);}',
          'else if(', shared.vao, '.currentVAO){',
          ELEMENTS, '=', env.shared.elements + '.getElements(' + shared.vao, '.currentVAO.elements);',
          (!extVertexArrays ? 'if(' + ELEMENTS + ')' + GL + '.bindBuffer(' + GL_ELEMENT_ARRAY_BUFFER$2 + ',' + ELEMENTS + '.buffer.buffer);' : ''),
          '}')
      }
      return ELEMENTS
    }

    function emitCount () {
      var defn = drawOptions.count
      var COUNT
      var scope = outer
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          scope = inner
        }
        COUNT = defn.append(env, scope)
        check$1.optional(function () {
          if (defn.MISSING) {
            env.assert(outer, 'false', 'missing vertex count')
          }
          if (defn.DYNAMIC) {
            env.assert(scope, COUNT + '>=0', 'missing vertex count')
          }
        })
      } else {
        COUNT = scope.def(DRAW_STATE, '.', S_COUNT)
        check$1.optional(function () {
          env.assert(scope, COUNT + '>=0', 'missing vertex count')
        })
      }
      return COUNT
    }

    var ELEMENTS = emitElements()
    function emitValue (name) {
      var defn = drawOptions[name]
      if (defn) {
        if ((defn.contextDep && args.contextDynamic) || defn.propDep) {
          return defn.append(env, inner)
        } else {
          return defn.append(env, outer)
        }
      } else {
        return outer.def(DRAW_STATE, '.', name)
      }
    }

    var PRIMITIVE = emitValue(S_PRIMITIVE)
    var OFFSET = emitValue(S_OFFSET)

    var COUNT = emitCount()
    if (typeof COUNT === 'number') {
      if (COUNT === 0) {
        return
      }
    } else {
      inner('if(', COUNT, '){')
      inner.exit('}')
    }

    var INSTANCES, EXT_INSTANCING
    if (extInstancing) {
      INSTANCES = emitValue(S_INSTANCES)
      EXT_INSTANCING = env.instancing
    }

    var ELEMENT_TYPE = ELEMENTS + '.type'

    var elementsStatic = drawOptions.elements && isStatic(drawOptions.elements) && !drawOptions.vaoActive

    function emitInstancing () {
      function drawElements () {
        inner(EXT_INSTANCING, '.drawElementsInstancedANGLE(', [
          PRIMITIVE,
          COUNT,
          ELEMENT_TYPE,
          OFFSET + '<<((' + ELEMENT_TYPE + '-' + GL_UNSIGNED_BYTE$8 + ')>>1)',
          INSTANCES
        ], ');')
      }

      function drawArrays () {
        inner(EXT_INSTANCING, '.drawArraysInstancedANGLE(',
          [PRIMITIVE, OFFSET, COUNT, INSTANCES], ');')
      }

      if (ELEMENTS && ELEMENTS !== 'null') {
        if (!elementsStatic) {
          inner('if(', ELEMENTS, '){')
          drawElements()
          inner('}else{')
          drawArrays()
          inner('}')
        } else {
          drawElements()
        }
      } else {
        drawArrays()
      }
    }

    function emitRegular () {
      function drawElements () {
        inner(GL + '.drawElements(' + [
          PRIMITIVE,
          COUNT,
          ELEMENT_TYPE,
          OFFSET + '<<((' + ELEMENT_TYPE + '-' + GL_UNSIGNED_BYTE$8 + ')>>1)'
        ] + ');')
      }

      function drawArrays () {
        inner(GL + '.drawArrays(' + [PRIMITIVE, OFFSET, COUNT] + ');')
      }

      if (ELEMENTS && ELEMENTS !== 'null') {
        if (!elementsStatic) {
          inner('if(', ELEMENTS, '){')
          drawElements()
          inner('}else{')
          drawArrays()
          inner('}')
        } else {
          drawElements()
        }
      } else {
        drawArrays()
      }
    }

    if (extInstancing && (typeof INSTANCES !== 'number' || INSTANCES >= 0)) {
      if (typeof INSTANCES === 'string') {
        inner('if(', INSTANCES, '>0){')
        emitInstancing()
        inner('}else if(', INSTANCES, '<0){')
        emitRegular()
        inner('}')
      } else {
        emitInstancing()
      }
    } else {
      emitRegular()
    }
  }

  function createBody (emitBody, parentEnv, args, program, count) {
    var env = createREGLEnvironment({args, config, type: "createBody"})
    var scope = env.proc('body', count)
    check$1.optional(function () {
      env.commandStr = parentEnv.commandStr
      env.command = env.link(parentEnv.commandStr)
    })
    if (extInstancing) {
      env.instancing = scope.def(
        env.shared.extensions, '.angle_instanced_arrays')
    }
    emitBody(env, scope, args, program)
    return env.compile().body
  }

  // ===================================================
  // ===================================================
  // DRAW PROC
  // ===================================================
  // ===================================================
  function emitDrawBody (env, draw, args, program) {
    injectExtensions(env, draw)
    if (args.useVAO) {
      if (args.drawVAO) {
        draw(env.shared.vao, '.setVAO(', args.drawVAO.append(env, draw), ');')
      } else {
        draw(env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')
      }
    } else {
      draw(env.shared.vao, '.setVAO(null);')
      emitAttributes(env, draw, args, program.attributes, function () {
        return true
      })
    }
    emitUniforms(env, draw, args, program.uniforms, function () {
      return true
    }, false)
    emitDraw(env, draw, draw, args)
  }

  function emitDrawProc (env, args) {
    var draw = env.proc('draw', 1)

    injectExtensions(env, draw)

    emitContext(env, draw, args.context)
    emitPollFramebuffer(env, draw, args.framebuffer)

    emitPollState(env, draw, args)
    emitSetOptions(env, draw, args.state)

    emitProfile(env, draw, args, false, true)

    var program = args.shader.progVar.append(env, draw)
    draw(env.shared.gl, '.useProgram(', program, '.program);')

    if (args.shader.program) {
      emitDrawBody(env, draw, args, args.shader.program)
    } else {
      draw(env.shared.vao, '.setVAO(null);')
      var drawCache = env.global.def('{}')
      var PROG_ID = draw.def(program, '.id')
      var CACHED_PROC = draw.def(drawCache, '[', PROG_ID, ']')
      draw(
        env.cond(CACHED_PROC)
          .then(CACHED_PROC, '.call(this,a0);')
          .else(
            CACHED_PROC, '=', drawCache, '[', PROG_ID, ']=',
            env.link(function (program) {
              return createBody(emitDrawBody, env, args, program, 1)
            }), '(', program, ');',
            CACHED_PROC, '.call(this,a0);'))
    }

    if (Object.keys(args.state).length > 0) {
      draw(env.shared.current, '.dirty=true;')
    }
    if (env.shared.vao) {
      draw(env.shared.vao, '.setVAO(null);')
    }
  }

  // ===================================================
  // ===================================================
  // BATCH PROC
  // ===================================================
  // ===================================================

  function emitBatchDynamicShaderBody (env, scope, args, program) {
    env.batchId = 'a1'

    injectExtensions(env, scope)

    function all () {
      return true
    }

    emitAttributes(env, scope, args, program.attributes, all)
    emitUniforms(env, scope, args, program.uniforms, all, false)
    emitDraw(env, scope, scope, args)
  }

  function emitBatchBody (env, scope, args, program) {
    injectExtensions(env, scope)

    var contextDynamic = args.contextDep

    var BATCH_ID = scope.def()
    var PROP_LIST = 'a0'
    var NUM_PROPS = 'a1'
    var PROPS = scope.def()
    env.shared.props = PROPS
    env.batchId = BATCH_ID

    var outer = env.scope()
    var inner = env.scope()

    scope(
      outer.entry,
      'for(', BATCH_ID, '=0;', BATCH_ID, '<', NUM_PROPS, ';++', BATCH_ID, '){',
      PROPS, '=', PROP_LIST, '[', BATCH_ID, '];',
      inner,
      '}',
      outer.exit)

    function isInnerDefn (defn) {
      return ((defn.contextDep && contextDynamic) || defn.propDep)
    }

    function isOuterDefn (defn) {
      return !isInnerDefn(defn)
    }

    if (args.needsContext) {
      emitContext(env, inner, args.context)
    }
    if (args.needsFramebuffer) {
      emitPollFramebuffer(env, inner, args.framebuffer)
    }
    emitSetOptions(env, inner, args.state, isInnerDefn)

    if (args.profile && isInnerDefn(args.profile)) {
      emitProfile(env, inner, args, false, true)
    }

    if (!program) {
      var progCache = env.global.def('{}')
      var PROGRAM = args.shader.progVar.append(env, inner)
      var PROG_ID = inner.def(PROGRAM, '.id')
      var CACHED_PROC = inner.def(progCache, '[', PROG_ID, ']')
      inner(
        env.shared.gl, '.useProgram(', PROGRAM, '.program);',
        'if(!', CACHED_PROC, '){',
        CACHED_PROC, '=', progCache, '[', PROG_ID, ']=',
        env.link(function (program) {
          return createBody(
            emitBatchDynamicShaderBody, env, args, program, 2)
        }), '(', PROGRAM, ');}',
        CACHED_PROC, '.call(this,a0[', BATCH_ID, '],', BATCH_ID, ');')
    } else {
      if (args.useVAO) {
        if (args.drawVAO) {
          if (isInnerDefn(args.drawVAO)) {
            // vao is a prop
            inner(env.shared.vao, '.setVAO(', args.drawVAO.append(env, inner), ');')
          } else {
            // vao is invariant
            outer(env.shared.vao, '.setVAO(', args.drawVAO.append(env, outer), ');')
          }
        } else {
          // scoped vao binding
          outer(env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')
        }
      } else {
        outer(env.shared.vao, '.setVAO(null);')
        emitAttributes(env, outer, args, program.attributes, isOuterDefn)
        emitAttributes(env, inner, args, program.attributes, isInnerDefn)
      }
      emitUniforms(env, outer, args, program.uniforms, isOuterDefn, false)
      emitUniforms(env, inner, args, program.uniforms, isInnerDefn, true)
      emitDraw(env, outer, inner, args)
    }
  }

  function emitBatchProc (env, args) {
    var batch = env.proc('batch', 2)
    env.batchId = '0'

    injectExtensions(env, batch)

    // Check if any context variables depend on props
    var contextDynamic = false
    var needsContext = true
    Object.keys(args.context).forEach(function (name) {
      contextDynamic = contextDynamic || args.context[name].propDep
    })
    if (!contextDynamic) {
      emitContext(env, batch, args.context)
      needsContext = false
    }

    // framebuffer state affects framebufferWidth/height context vars
    var framebuffer = args.framebuffer
    var needsFramebuffer = false
    if (framebuffer) {
      if (framebuffer.propDep) {
        contextDynamic = needsFramebuffer = true
      } else if (framebuffer.contextDep && contextDynamic) {
        needsFramebuffer = true
      }
      if (!needsFramebuffer) {
        emitPollFramebuffer(env, batch, framebuffer)
      }
    } else {
      emitPollFramebuffer(env, batch, null)
    }

    // viewport is weird because it can affect context vars
    if (args.state.viewport && args.state.viewport.propDep) {
      contextDynamic = true
    }

    function isInnerDefn (defn) {
      return (defn.contextDep && contextDynamic) || defn.propDep
    }

    // set webgl options
    emitPollState(env, batch, args)
    emitSetOptions(env, batch, args.state, function (defn) {
      return !isInnerDefn(defn)
    })

    if (!args.profile || !isInnerDefn(args.profile)) {
      emitProfile(env, batch, args, false, 'a1')
    }

    // Save these values to args so that the batch body routine can use them
    args.contextDep = contextDynamic
    args.needsContext = needsContext
    args.needsFramebuffer = needsFramebuffer

    // determine if shader is dynamic
    var progDefn = args.shader.progVar
    if ((progDefn.contextDep && contextDynamic) || progDefn.propDep) {
      emitBatchBody(
        env,
        batch,
        args,
        null)
    } else {
      var PROGRAM = progDefn.append(env, batch)
      batch(env.shared.gl, '.useProgram(', PROGRAM, '.program);')
      if (args.shader.program) {
        emitBatchBody(
          env,
          batch,
          args,
          args.shader.program)
      } else {
        batch(env.shared.vao, '.setVAO(null);')
        var batchCache = env.global.def('{}')
        var PROG_ID = batch.def(PROGRAM, '.id')
        var CACHED_PROC = batch.def(batchCache, '[', PROG_ID, ']')
        batch(
          env.cond(CACHED_PROC)
            .then(CACHED_PROC, '.call(this,a0,a1);')
            .else(
              CACHED_PROC, '=', batchCache, '[', PROG_ID, ']=',
              env.link(function (program) {
                return createBody(emitBatchBody, env, args, program, 2)
              }), '(', PROGRAM, ');',
              CACHED_PROC, '.call(this,a0,a1);'))
      }
    }

    if (Object.keys(args.state).length > 0) {
      batch(env.shared.current, '.dirty=true;')
    }

    if (env.shared.vao) {
      batch(env.shared.vao, '.setVAO(null);')
    }
  }

  // ===================================================
  // ===================================================
  // SCOPE COMMAND
  // ===================================================
  // ===================================================
  function emitScopeProc (env, args) {
    var scope = env.proc('scope', 3)
    env.batchId = 'a2'

    var shared = env.shared
    var CURRENT_STATE = shared.current

    emitContext(env, scope, args.context)

    if (args.framebuffer) {
      args.framebuffer.append(env, scope)
    }

    sortState(Object.keys(args.state)).forEach(function (name) {
      var defn = args.state[name]
      var value = defn.append(env, scope)
      if (isArrayLike(value)) {
        value.forEach(function (v, i) {
          scope.set(env.next[name], '[' + i + ']', env.stableRef(v))
        })
      } else {
        scope.set(shared.next, '.' + name, env.stableRef(value))
      }
    })

    emitProfile(env, scope, args, true, true)

    ;[S_ELEMENTS, S_OFFSET, S_COUNT, S_INSTANCES, S_PRIMITIVE].forEach(
      function (opt) {
        var variable = args.draw[opt]
        if (!variable) {
          return
        }
        scope.set(shared.draw, '.' + opt, env.stableRef('' + variable.append(env, scope)))
      })

    Object.keys(args.uniforms).forEach(function (opt) {
      var value = args.uniforms[opt].append(env, scope)
      if (Array.isArray(value)) {
        value = '[' + env.stableRef(value.join()) + ']'
      }
      scope.set(
        shared.uniforms,
        '[' + env.stableRef(stringStore.id(opt)) + ']',
        value)
    })

    Object.keys(args.attributes).forEach(function (name) {
      var record = args.attributes[name].append(env, scope)
      var scopeAttrib = env.scopeAttrib(name)
      Object.keys(new AttributeRecord()).forEach(function (prop) {
        scope.set(scopeAttrib, '.' + prop, record[prop])
      })
    })

    if (args.scopeVAO) {
      scope.set(shared.vao, '.targetVAO', env.stableRef(args.scopeVAO.append(env, scope)))
    }

    function saveShader (name) {
      var shader = args.shader[name]
      if (shader) {
        scope.set(shared.shader, '.' + name, env.stableRef(shader.append(env, scope)))
      }
    }
    saveShader(S_VERT)
    saveShader(S_FRAG)

    if (Object.keys(args.state).length > 0) {
      scope(CURRENT_STATE, '.dirty=true;')
      scope.exit(CURRENT_STATE, '.dirty=true;')
    }

    scope('a1(', env.shared.context, ',a0,', env.batchId, ');')
  }

  function isDynamicObject (object) {
    if (typeof object !== 'object' || isArrayLike(object)) {
      return
    }
    var props = Object.keys(object)
    for (var i = 0; i < props.length; ++i) {
      if (dynamic.isDynamic(object[props[i]])) {
        return true
      }
    }
    return false
  }

  function splatObject (env, options, name) {
    var object = options.static[name]
    if (!object || !isDynamicObject(object)) {
      return
    }

    var globals = env.global
    var keys = Object.keys(object)
    var thisDep = false
    var contextDep = false
    var propDep = false
    var objectRef = env.global.def('{}')
    keys.forEach(function (key) {
      var value = object[key]
      if (dynamic.isDynamic(value)) {
        if (typeof value === 'function') {
          value = object[key] = dynamic.unbox(value)
        }
        var deps = createDynamicDecl(value, null)
        thisDep = thisDep || deps.thisDep
        propDep = propDep || deps.propDep
        contextDep = contextDep || deps.contextDep
      } else {
        globals(objectRef, '.', key, '=')
        switch (typeof value) {
          case 'number':
            globals(value)
            break
          case 'string':
            globals('"', value, '"')
            break
          case 'object':
            if (Array.isArray(value)) {
              globals('[', value.join(), ']')
            }
            break
          default:
            globals(env.link(value))
            break
        }
        globals(';')
      }
    })

    function appendBlock (env, block) {
      keys.forEach(function (key) {
        var value = object[key]
        if (!dynamic.isDynamic(value)) {
          return
        }
        var ref = env.invoke(block, value)
        block(objectRef, '.', key, '=', ref, ';')
      })
    }

    options.dynamic[name] = new dynamic.DynamicVariable(DYN_THUNK, {
      thisDep: thisDep,
      contextDep: contextDep,
      propDep: propDep,
      ref: objectRef,
      append: appendBlock
    })
    delete options.static[name]
  }

  // ===========================================================================
  // ===========================================================================
  // MAIN DRAW COMMAND
  // ===========================================================================
  // ===========================================================================
  function compileCommand (options, attributes, uniforms, context, stats, debug) {
    var env = createREGLEnvironment(debug)

    // link stats, so that we can easily access it in the program.
    env.stats = env.link(stats)

    // splat options and attributes to allow for dynamic nested properties
    Object.keys(attributes.static).forEach(function (key) {
      splatObject(env, attributes, key)
    })
    NESTED_OPTIONS.forEach(function (name) {
      splatObject(env, options, name)
    })

    var args = parseArguments(options, attributes, uniforms, context, env)

    // Fix code stability issue across platforms and runs
    if (args.shader.program) {
      args.shader.program.attributes.sort((a, b) => a.name < b.name ? -1 : 1)
      args.shader.program.uniforms.sort((a, b) => a.name < b.name ? -1 : 1)
    }
    
    env.globalScope = {};
    env.globalScopeCounter = 0;
    env.stableRef = function(val) {
      this.globalScope[this.globalScopeCounter] = val;
      return "_gs[" + this.globalScopeCounter++ + "]";
    }

    emitDrawProc(env, args)
    emitScopeProc(env, args)
    emitBatchProc(env, args)

    return extend(env.compile(env.globalScope), {
      destroy: function () {
        args.shader.program.destroy()
      }
    })
  }

  // ===========================================================================
  // ===========================================================================
  // POLL / REFRESH
  // ===========================================================================
  // ===========================================================================
  return {
    next: nextState,
    current: currentState,
    procs: (function () {
      var env = createREGLEnvironment({config, type: "poll/refresh"})
      var poll = env.proc('poll')
      var refresh = env.proc('refresh')
      var common = env.block()
      poll(common)
      refresh(common)

      var shared = env.shared
      var GL = shared.gl
      var NEXT_STATE = shared.next
      var CURRENT_STATE = shared.current

      common(CURRENT_STATE, '.dirty=false;')

      emitPollFramebuffer(env, poll)
      emitPollFramebuffer(env, refresh, null, true)

      // Refresh updates all attribute state changes
      var INSTANCING
      if (extInstancing) {
        INSTANCING = env.link(extInstancing)
      }

      // update vertex array bindings
      if (extensions.oes_vertex_array_object) {
        refresh(env.link(extensions.oes_vertex_array_object), '.bindVertexArrayOES(null);')
      }
      var MAX_ATTRIBUTES = env.link(limits.maxAttributes)
      //for (var i = 0; i < limits.maxAttributes; ++i) {

      
        var BINDING = refresh.def(shared.attributes)


        var ifte = env.cond(BINDING, '[i].buffer')
        ifte.then(
          GL, '.enableVertexAttribArray(i);',
          GL, '.bindBuffer(',
          GL_ARRAY_BUFFER$2, ',',
          BINDING, '[i].buffer.buffer);',
          GL, '.vertexAttribPointer(i,',
          BINDING, '[i].size,',
          BINDING, '[i].type,',
          BINDING, '[i].normalized,',
          BINDING, '[i].stride,',
          BINDING, '[i].offset);'
        ).else(
          GL, '.disableVertexAttribArray(i);',
          GL, '.vertexAttrib4f(i,',
          BINDING, '[i].x,',
          BINDING, '[i].y,',
          BINDING, '[i].z,',
          BINDING, '[i].w);',
          BINDING, '[i].buffer=null;')
        refresh(
          'for(var i=0;i<', MAX_ATTRIBUTES, ';++i){',
          ifte,
          '}'
        )

        if (extInstancing) {
          refresh(
            'for(var i=0;i<', MAX_ATTRIBUTES, ';++i){',
            INSTANCING, '.vertexAttribDivisorANGLE(i,',
            BINDING, '[i].divisor);',
            '}')
        }
      //}
      refresh(
        env.shared.vao, '.currentVAO=null;',
        env.shared.vao, '.setVAO(', env.shared.vao, '.targetVAO);')

      Object.keys(GL_FLAGS).forEach(function (flag) {
        var cap = GL_FLAGS[flag]
        var NEXT = common.def(NEXT_STATE, '.', flag)
        var block = env.block()
        block('if(', NEXT, '){',
          GL, '.enable(', cap, ')}else{',
          GL, '.disable(', cap, ')}',
          CURRENT_STATE, '.', flag, '=', NEXT, ';')
        refresh(block)
        poll(
          'if(', NEXT, '!==', CURRENT_STATE, '.', flag, '){',
          block,
          '}')
      })

      Object.keys(GL_VARIABLES).forEach(function (name) {
        var func = GL_VARIABLES[name]
        var init = currentState[name]
        var NEXT, CURRENT
        var block = env.block()
        block(GL, '.', func, '(')
        if (isArrayLike(init)) {
          var n = init.length
          NEXT = env.global.def(NEXT_STATE, '.', name)
          CURRENT = env.global.def(CURRENT_STATE, '.', name)
          block(
            loop(n, function (i) {
              return NEXT + '[' + i + ']'
            }), ');',
            loop(n, function (i) {
              return CURRENT + '[' + i + ']=' + NEXT + '[' + i + '];'
            }).join(''))
          poll(
            'if(', loop(n, function (i) {
              return NEXT + '[' + i + ']!==' + CURRENT + '[' + i + ']'
            }).join('||'), '){',
            block,
            '}')
        } else {
          NEXT = common.def(NEXT_STATE, '.', name)
          CURRENT = common.def(CURRENT_STATE, '.', name)
          block(
            NEXT, ');',
            CURRENT_STATE, '.', name, '=', NEXT, ';')
          poll(
            'if(', NEXT, '!==', CURRENT, '){',
            block,
            '}')
        }
        refresh(block)
      })

      return env.compile()
    })(),
    compile: compileCommand
  }
}

function stats () {
  return {
    vaoCount: 0,
    bufferCount: 0,
    elementsCount: 0,
    framebufferCount: 0,
    shaderCount: 0,
    textureCount: 0,
    cubeCount: 0,
    renderbufferCount: 0,
    maxTextureUnits: 0
  }
}

var GL_QUERY_RESULT_EXT = 0x8866
var GL_QUERY_RESULT_AVAILABLE_EXT = 0x8867
var GL_TIME_ELAPSED_EXT = 0x88BF

var createTimer = function (gl, extensions) {
  if (!extensions.ext_disjoint_timer_query) {
    return null
  }

  // QUERY POOL BEGIN
  var queryPool = []
  function allocQuery () {
    return queryPool.pop() || extensions.ext_disjoint_timer_query.createQueryEXT()
  }
  function freeQuery (query) {
    queryPool.push(query)
  }
  // QUERY POOL END

  var pendingQueries = []
  function beginQuery (stats) {
    var query = allocQuery()
    extensions.ext_disjoint_timer_query.beginQueryEXT(GL_TIME_ELAPSED_EXT, query)
    pendingQueries.push(query)
    pushScopeStats(pendingQueries.length - 1, pendingQueries.length, stats)
  }

  function endQuery () {
    extensions.ext_disjoint_timer_query.endQueryEXT(GL_TIME_ELAPSED_EXT)
  }

  //
  // Pending stats pool.
  //
  function PendingStats () {
    this.startQueryIndex = -1
    this.endQueryIndex = -1
    this.sum = 0
    this.stats = null
  }
  var pendingStatsPool = []
  function allocPendingStats () {
    return pendingStatsPool.pop() || new PendingStats()
  }
  function freePendingStats (pendingStats) {
    pendingStatsPool.push(pendingStats)
  }
  // Pending stats pool end

  var pendingStats = []
  function pushScopeStats (start, end, stats) {
    var ps = allocPendingStats()
    ps.startQueryIndex = start
    ps.endQueryIndex = end
    ps.sum = 0
    ps.stats = stats
    pendingStats.push(ps)
  }

  // we should call this at the beginning of the frame,
  // in order to update gpuTime
  var timeSum = []
  var queryPtr = []
  function update () {
    var ptr, i

    var n = pendingQueries.length
    if (n === 0) {
      return
    }

    // Reserve space
    queryPtr.length = Math.max(queryPtr.length, n + 1)
    timeSum.length = Math.max(timeSum.length, n + 1)
    timeSum[0] = 0
    queryPtr[0] = 0

    // Update all pending timer queries
    var queryTime = 0
    ptr = 0
    for (i = 0; i < pendingQueries.length; ++i) {
      var query = pendingQueries[i]
      if (extensions.ext_disjoint_timer_query.getQueryObjectEXT(query, GL_QUERY_RESULT_AVAILABLE_EXT)) {
        queryTime += extensions.ext_disjoint_timer_query.getQueryObjectEXT(query, GL_QUERY_RESULT_EXT)
        freeQuery(query)
      } else {
        pendingQueries[ptr++] = query
      }
      timeSum[i + 1] = queryTime
      queryPtr[i + 1] = ptr
    }
    pendingQueries.length = ptr

    // Update all pending stat queries
    ptr = 0
    for (i = 0; i < pendingStats.length; ++i) {
      var stats = pendingStats[i]
      var start = stats.startQueryIndex
      var end = stats.endQueryIndex
      stats.sum += timeSum[end] - timeSum[start]
      var startPtr = queryPtr[start]
      var endPtr = queryPtr[end]
      if (endPtr === startPtr) {
        stats.stats.gpuTime += stats.sum / 1e6
        freePendingStats(stats)
      } else {
        stats.startQueryIndex = startPtr
        stats.endQueryIndex = endPtr
        pendingStats[ptr++] = stats
      }
    }
    pendingStats.length = ptr
  }

  return {
    beginQuery: beginQuery,
    endQuery: endQuery,
    pushScopeStats: pushScopeStats,
    update: update,
    getNumPendingQueries: function () {
      return pendingQueries.length
    },
    clear: function () {
      queryPool.push.apply(queryPool, pendingQueries)
      for (var i = 0; i < queryPool.length; i++) {
        extensions.ext_disjoint_timer_query.deleteQueryEXT(queryPool[i])
      }
      pendingQueries.length = 0
      queryPool.length = 0
    },
    restore: function () {
      pendingQueries.length = 0
      queryPool.length = 0
    }
  }
}

var GL_COLOR_BUFFER_BIT = 16384
var GL_DEPTH_BUFFER_BIT = 256
var GL_STENCIL_BUFFER_BIT = 1024

var GL_ARRAY_BUFFER = 34962

var CONTEXT_LOST_EVENT = 'webglcontextlost'
var CONTEXT_RESTORED_EVENT = 'webglcontextrestored'

var DYN_PROP = 1
var DYN_CONTEXT = 2
var DYN_STATE = 3

function find (haystack, needle) {
  for (var i = 0; i < haystack.length; ++i) {
    if (haystack[i] === needle) {
      return i
    }
  }
  return -1
}

function wrapREGL (args) {
  var config = parseArgs(args)
  if (!config) {
    return null
  }

  var gl = config.gl
  var glAttributes = gl.getContextAttributes()
  var contextLost = gl.isContextLost()

  var extensionState = createExtensionCache(gl, config)
  if (!extensionState) {
    return null
  }

  var stringStore = createStringStore()
  var stats$$1 = stats()
  var extensions = extensionState.extensions
  var timer = createTimer(gl, extensions)

  var START_TIME = clock()
  var WIDTH = gl.drawingBufferWidth
  var HEIGHT = gl.drawingBufferHeight

  var contextState = {
    tick: 0,
    time: 0,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    framebufferWidth: WIDTH,
    framebufferHeight: HEIGHT,
    drawingBufferWidth: WIDTH,
    drawingBufferHeight: HEIGHT,
    pixelRatio: config.pixelRatio
  }
  var uniformState = {}
  var drawState = {
    elements: null,
    primitive: 4, // GL_TRIANGLES
    count: -1,
    offset: 0,
    instances: -1
  }

  var limits = wrapLimits(gl, extensions)
  var bufferState = wrapBufferState(
    gl,
    stats$$1,
    config,
    destroyBuffer)
  var elementState = wrapElementsState(gl, extensions, bufferState, stats$$1)
  var attributeState = wrapAttributeState(
    gl,
    extensions,
    limits,
    stats$$1,
    bufferState,
    elementState,
    drawState)
  function destroyBuffer (buffer) {
    return attributeState.destroyBuffer(buffer)
  }
  var shaderState = wrapShaderState(gl, stringStore, stats$$1, config)
  var textureState = createTextureSet(
    gl,
    extensions,
    limits,
    function () { core.procs.poll() },
    contextState,
    stats$$1,
    config)
  var renderbufferState = wrapRenderbuffers(gl, extensions, limits, stats$$1, config)
  var framebufferState = wrapFBOState(
    gl,
    extensions,
    limits,
    textureState,
    renderbufferState,
    stats$$1)
  var core = reglCore(
    gl,
    stringStore,
    extensions,
    limits,
    bufferState,
    elementState,
    textureState,
    framebufferState,
    uniformState,
    attributeState,
    shaderState,
    drawState,
    contextState,
    timer,
    config)
  var readPixels = wrapReadPixels(
    gl,
    framebufferState,
    core.procs.poll,
    contextState,
    glAttributes, extensions, limits)

  var nextState = core.next
  var canvas = gl.canvas

  var rafCallbacks = []
  var lossCallbacks = []
  var restoreCallbacks = []
  var destroyCallbacks = [config.onDestroy]

  var activeRAF = null
  function handleRAF () {
    if (rafCallbacks.length === 0) {
      if (timer) {
        timer.update()
      }
      activeRAF = null
      return
    }

    // schedule next animation frame
    activeRAF = raf.next(handleRAF)

    // poll for changes
    poll()

    // fire a callback for all pending rafs
    for (var i = rafCallbacks.length - 1; i >= 0; --i) {
      var cb = rafCallbacks[i]
      if (cb) {
        cb(contextState, null, 0)
      }
    }

    // flush all pending webgl calls
    gl.flush()

    // poll GPU timers *after* gl.flush so we don't delay command dispatch
    if (timer) {
      timer.update()
    }
  }

  function startRAF () {
    if (!activeRAF && rafCallbacks.length > 0) {
      activeRAF = raf.next(handleRAF)
    }
  }

  function stopRAF () {
    if (activeRAF) {
      raf.cancel(handleRAF)
      activeRAF = null
    }
  }

  function handleContextLoss (event) {
    event.preventDefault()

    // set context lost flag
    contextLost = true

    // pause request animation frame
    stopRAF()

    // lose context
    lossCallbacks.forEach(function (cb) {
      cb()
    })
  }

  function handleContextRestored (event) {
    // clear error code
    gl.getError()

    // clear context lost flag
    contextLost = false

    // refresh state
    extensionState.restore()
    shaderState.restore()
    bufferState.restore()
    textureState.restore()
    renderbufferState.restore()
    framebufferState.restore()
    attributeState.restore()
    if (timer) {
      timer.restore()
    }

    // refresh state
    core.procs.refresh()

    // restart RAF
    startRAF()

    // restore context
    restoreCallbacks.forEach(function (cb) {
      cb()
    })
  }

  if (canvas) {
    canvas.addEventListener(CONTEXT_LOST_EVENT, handleContextLoss, false)
    canvas.addEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored, false)
  }

  function destroy () {
    rafCallbacks.length = 0
    stopRAF()

    if (canvas) {
      canvas.removeEventListener(CONTEXT_LOST_EVENT, handleContextLoss)
      canvas.removeEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored)
    }

    shaderState.clear()
    framebufferState.clear()
    renderbufferState.clear()
    attributeState.clear()
    textureState.clear()
    elementState.clear()
    bufferState.clear()

    if (timer) {
      timer.clear()
    }

    destroyCallbacks.forEach(function (cb) {
      cb()
    })
  }

  function compileProcedure (options) {
    check$1(!!options, 'invalid args to regl({...})')
    check$1.type(options, 'object', 'invalid args to regl({...})')

    function flattenNestedOptions (options) {
      var result = extend({}, options)
      delete result.uniforms
      delete result.attributes
      delete result.context
      delete result.vao

      if ('stencil' in result && result.stencil.op) {
        result.stencil.opBack = result.stencil.opFront = result.stencil.op
        delete result.stencil.op
      }

      function merge (name) {
        if (name in result) {
          var child = result[name]
          delete result[name]
          Object.keys(child).forEach(function (prop) {
            result[name + '.' + prop] = child[prop]
          })
        }
      }
      merge('blend')
      merge('depth')
      merge('cull')
      merge('stencil')
      merge('polygonOffset')
      merge('scissor')
      merge('sample')

      if ('vao' in options) {
        result.vao = options.vao
      }

      return result
    }

    function separateDynamic (object, useArrays) {
      var staticItems = {}
      var dynamicItems = {}
      Object.keys(object).forEach(function (option) {
        var value = object[option]
        if (dynamic.isDynamic(value)) {
          dynamicItems[option] = dynamic.unbox(value, option)
          return
        } else if (useArrays && Array.isArray(value)) {
          for (var i = 0; i < value.length; ++i) {
            if (dynamic.isDynamic(value[i])) {
              dynamicItems[option] = dynamic.unbox(value, option)
              return
            }
          }
        }
        staticItems[option] = value
      })
      return {
        dynamic: dynamicItems,
        static: staticItems
      }
    }

    // Treat context variables separate from other dynamic variables
    var context = separateDynamic(options.context || {}, true)
    var uniforms = separateDynamic(options.uniforms || {}, true)
    var attributes = separateDynamic(options.attributes || {}, false)
    var opts = separateDynamic(flattenNestedOptions(options), false)

    var stats$$1 = {
      gpuTime: 0.0,
      cpuTime: 0.0,
      count: 0
    }

    var compiled = core.compile(opts, attributes, uniforms, context, stats$$1, {options, args})

    var draw = compiled.draw
    var batch = compiled.batch
    var scope = compiled.scope

    // FIXME: we should modify code generation for batch commands so this
    // isn't necessary
    var EMPTY_ARRAY = []
    function reserve (count) {
      while (EMPTY_ARRAY.length < count) {
        EMPTY_ARRAY.push(null)
      }
      return EMPTY_ARRAY
    }

    function REGLCommand (args, body) {
      var i
      if (contextLost) {
        check$1.raise('context lost')
      }
      if (typeof args === 'function') {
        return scope.call(this, null, args, 0)
      } else if (typeof body === 'function') {
        if (typeof args === 'number') {
          for (i = 0; i < args; ++i) {
            scope.call(this, null, body, i)
          }
        } else if (Array.isArray(args)) {
          for (i = 0; i < args.length; ++i) {
            scope.call(this, args[i], body, i)
          }
        } else {
          return scope.call(this, args, body, 0)
        }
      } else if (typeof args === 'number') {
        if (args > 0) {
          return batch.call(this, reserve(args | 0), args | 0)
        }
      } else if (Array.isArray(args)) {
        if (args.length) {
          return batch.call(this, args, args.length)
        }
      } else {
        return draw.call(this, args)
      }
    }

    return extend(REGLCommand, {
      stats: stats$$1,
      destroy: function () {
        compiled.destroy()
      }
    })
  }

  var setFBO = framebufferState.setFBO = compileProcedure({
    framebuffer: dynamic.define.call(null, DYN_PROP, 'framebuffer')
  })

  function clearImpl (_, options) {
    var clearFlags = 0
    core.procs.poll()

    var c = options.color
    if (c) {
      gl.clearColor(+c[0] || 0, +c[1] || 0, +c[2] || 0, +c[3] || 0)
      clearFlags |= GL_COLOR_BUFFER_BIT
    }
    if ('depth' in options) {
      gl.clearDepth(+options.depth)
      clearFlags |= GL_DEPTH_BUFFER_BIT
    }
    if ('stencil' in options) {
      gl.clearStencil(options.stencil | 0)
      clearFlags |= GL_STENCIL_BUFFER_BIT
    }

    check$1(!!clearFlags, 'called regl.clear with no buffer specified')
    gl.clear(clearFlags)
  }

  function clear (options) {
    check$1(
      typeof options === 'object' && options,
      'regl.clear() takes an object as input')
    if ('framebuffer' in options) {
      if (options.framebuffer &&
          options.framebuffer_reglType === 'framebufferCube') {
        for (var i = 0; i < 6; ++i) {
          setFBO(extend({
            framebuffer: options.framebuffer.faces[i]
          }, options), clearImpl)
        }
      } else {
        setFBO(options, clearImpl)
      }
    } else {
      clearImpl(null, options)
    }
  }

  function frame (cb) {
    check$1.type(cb, 'function', 'regl.frame() callback must be a function')
    rafCallbacks.push(cb)

    function cancel () {
      // FIXME:  should we check something other than equals cb here?
      // what if a user calls frame twice with the same callback...
      //
      var i = find(rafCallbacks, cb)
      check$1(i >= 0, 'cannot cancel a frame twice')
      function pendingCancel () {
        var index = find(rafCallbacks, pendingCancel)
        rafCallbacks[index] = rafCallbacks[rafCallbacks.length - 1]
        rafCallbacks.length -= 1
        if (rafCallbacks.length <= 0) {
          stopRAF()
        }
      }
      rafCallbacks[i] = pendingCancel
    }

    startRAF()

    return {
      cancel: cancel
    }
  }

  // poll viewport
  function pollViewport () {
    var viewport = nextState.viewport
    var scissorBox = nextState.scissor_box
    viewport[0] = viewport[1] = scissorBox[0] = scissorBox[1] = 0
    contextState.viewportWidth =
      contextState.framebufferWidth =
      contextState.drawingBufferWidth =
      viewport[2] =
      scissorBox[2] = gl.drawingBufferWidth
    contextState.viewportHeight =
      contextState.framebufferHeight =
      contextState.drawingBufferHeight =
      viewport[3] =
      scissorBox[3] = gl.drawingBufferHeight
  }

  function poll () {
    contextState.tick += 1
    contextState.time = now()
    pollViewport()
    core.procs.poll()
  }

  function refresh () {
    textureState.refresh()
    pollViewport()
    core.procs.refresh()
    if (timer) {
      timer.update()
    }
  }

  function now () {
    return (clock() - START_TIME) / 1000.0
  }

  refresh()

  function addListener (event, callback) {
    check$1.type(callback, 'function', 'listener callback must be a function')

    var callbacks
    switch (event) {
      case 'frame':
        return frame(callback)
      case 'lost':
        callbacks = lossCallbacks
        break
      case 'restore':
        callbacks = restoreCallbacks
        break
      case 'destroy':
        callbacks = destroyCallbacks
        break
      default:
        check$1.raise('invalid event, must be one of frame,lost,restore,destroy')
    }

    callbacks.push(callback)
    return {
      cancel: function () {
        for (var i = 0; i < callbacks.length; ++i) {
          if (callbacks[i] === callback) {
            callbacks[i] = callbacks[callbacks.length - 1]
            callbacks.pop()
            return
          }
        }
      }
    }
  }

  var regl = extend(compileProcedure, {
    // Clear current FBO
    clear: clear,

    // Short cuts for dynamic variables
    prop: dynamic.define.bind(null, DYN_PROP),
    context: dynamic.define.bind(null, DYN_CONTEXT),
    this: dynamic.define.bind(null, DYN_STATE),

    // executes an empty draw command
    draw: compileProcedure({}),

    // Resources
    buffer: function (options) {
      return bufferState.create(options, GL_ARRAY_BUFFER, false, false)
    },
    elements: function (options) {
      return elementState.create(options, false)
    },
    texture: textureState.create2D,
    cube: textureState.createCube,
    renderbuffer: renderbufferState.create,
    framebuffer: framebufferState.create,
    framebufferCube: framebufferState.createCube,
    vao: attributeState.createVAO,

    // Expose context attributes
    attributes: glAttributes,

    // Frame rendering
    frame: frame,
    on: addListener,

    // System limits
    limits: limits,
    hasExtension: function (name) {
      return limits.extensions.indexOf(name.toLowerCase()) >= 0
    },

    // Read pixels
    read: readPixels,

    // Destroy regl and all associated resources
    destroy: destroy,

    // Direct GL state manipulation
    _gl: gl,
    _refresh: refresh,

    poll: function () {
      poll()
      if (timer) {
        timer.update()
      }
    },

    // Current time
    now: now,

    // regl Statistics Information
    stats: stats$$1
  })

  config.onDone(null, regl)

  return regl
}

return wrapREGL;

})));
//# sourceMappingURL=regl.js.map
