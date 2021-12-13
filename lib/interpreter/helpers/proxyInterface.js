
var K = require('../acorn');
console.log("acorn", window.acorn, K.Parser);
window.acorn = K;

var {Interpreter} = require('../interpreter');
var M = require('./in-machine-proxy');

var proxyHeader = M.proxyHeader;

function getPropertyWatchlist(object) {
  var watchlist = [];
  if (Array.isArray(object) || ArrayBuffer.isView(object)) {
    watchlist.push('length');
  }

  watchlist.push(...Object.keys(object));

  var curr = object;
  while (curr.__proto__) {
    curr = curr.__proto__;
    // TODO: for gl object there are MANY properties here. Find a way to reduce this.
    watchlist.push(...Object.keys(curr));
  }

  return watchlist;
}

// GLOSSARY
// native object - an object that exists in the host JS environment and is rigged in the interpreted environment.
// interpreter object - an object that exists in the interpreted environment only.

// LIMITATIONS:
// arguments from interpreter to real that are interpreter objects are not supported.
// Invoking an interpreter function using callInMachine does not produce a return value.
// Arrays inside the interpreter that are passed from heaven cannot be mutated. They have their "length" property
//   hacked in.

// MAYBE we have to extend it where we pass in the path of object return values to 
// the machine if the object is the same as one that's already stored, to satisfy
// equality with objects in the machine.
window.dataStores = [];
module.exports = function () {
  var data = {};
  window.dataStores.push(data);

  var objCnt = 0;
  var interpreter;

  function getValue(path) {
    console.log('getValue', path);
    var rawValue = getRawValue(path);
    return rawToMachine(rawValue, path);
  }

  // TODO: abstract this correctly - currently it is binding all functions.
  function getRawValue(path) {
    console.log('getRawvalue', path);
    var current = data;
    var prev = null;
    for (var i = 0; i < path.length; i++) {
      prev = current;
      current = current[path[i]];
    }
    if (typeof current === 'function') {
      let res = current.bind(prev);
      Object.defineProperty(res, '__internal', {
        value: current,
        enumerable: false,
      });
      //res.__internal = current;
      return res;
    }
    return current;
  };

  function setValue(path, value) {
    //console.log('setValue', path);
    var rawValue = machineToRaw(value);
    setRawValue(path, rawValue);
  }

  function setRawValue(path, value) {
    //console.log('setRawValue', path);
    var current = data;
    for (var i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
  }

  // LIMITATION: Object literals passed as a parameter to this function will not be mutable - changes
  // to the object will not be reflected in the interpreter.
  function call(path, args) {
    console.log('call', path, args);
    var rawArgs = args.map(arg => machineToRaw(arg));
    var fn = getRawValue(path);
    if (typeof fn !== 'function') {
      throw new Error('Not a function');
    }
    var raw = fn(...rawArgs.map((arg) => typeof arg === 'function' && arg.__internal ? arg.__internal : arg));
    if (typeof raw === 'object' || typeof raw === 'function') {
      var newPath = ['_retobj' + objCnt++];
      setRawValue(newPath, raw);
      return rawToMachine(raw, newPath);
    }
    return rawToMachine(raw, path);
  }

  function rawToMachine(rawValue, path) {
    //console.log('rawToMachine', rawValue, path);
    switch (typeof rawValue) {
      case 'object':
        if (rawValue !== null) { // if it is null, we let it fall down as a primitive below.
          return {
            type: 'object',
            path,
            keys: getPropertyWatchlist(rawValue),
          };
        }
      case 'string':
      case 'number':
      case 'boolean':
      case 'undefined':
        return {
          type: 'primitive',
          value: rawValue
        };
      case 'function':
        return {
          type: 'function',
          path,
          keys: getPropertyWatchlist(rawValue),
        };
      default:
        throw new Error('Unknown type: ' + typeof current);
    }
  }

  function deepMachineToRaw(obj) {
    if (typeof obj !== 'object') {
      return obj;
    }
    if (obj.__isHeavenlyObject) {
      return getRawValue(obj.__path);
    }
    return Object.keys(obj).reduce((acc, key) => {
      acc[key] = deepMachineToRaw(obj[key]);
      return acc;
    }, {});
  }

  //machineToRaw: function(machineValue) {
  function machineToRaw(machineValue) {
    //console.log('machineToRaw', machineValue);
    switch (machineValue.type) {
      case 'primitive':
        return machineValue.value;
      case 'object':
      case 'function':
        return getRawValue(machineValue.path);
      case 'object-literal':
        const obj = JSON.parse(machineValue.value);
        console.log("Literal object got from machine", obj);
        // swap all the heavenly object references to the actual objects recursively.
        const result = deepMachineToRaw(obj);
        console.log("Literal object translates to", result);
        return result;
      default:
        throw new Error('Unknown type: ' + machineValue.type);
    }
  }

  // TODO: memory cleanup
  function callInMachine(fn, thisArg, ...rawArgs) {
    data["g_this"] = thisArg;

    console.log('callInMachine', fn, thisArg, rawArgs);
    
    var machineArgs = (rawArgs || []).map(arg => {
      if (typeof arg === 'object') {
        var key = '_argobj' + objCnt++;
        data[key] = arg;
        console.log("linking object parameter", key, arg);
        return {
          type: 'object',
          path: [key],
          keys: getPropertyWatchlist(arg),
        };
      } else if (typeof arg === 'function') {
        var key = '_argfun' + objCnt++;
        data[key] = arg;
        return {
          type: 'function',
          path: [key],
        }
      } else {
        return {
          type: 'primitive',
          value: arg
        };
      }
    });

    console.log('machineArgs', machineArgs);

    var argNames = [];
    for (var machineArg of machineArgs) {
      var argName = '_arg' + objCnt++;
      argNames.push(argName);
      if (machineArg.type === 'object') {
        interpreter.appendCode(`var ${argName} = linkHeavenlyObject(${JSON.stringify(machineArg.path)}, ${JSON.stringify(machineArg.keys)});`);
      } else if (machineArg.type === 'function') {
        interpreter.appendCode(`var ${argName} = linkHeavenlyFunction(${JSON.stringify(machineArg.path)}, ${JSON.stringify(machineArg.keys)});`);
      } else {
        interpreter.appendCode(`var ${argName} = ${JSON.stringify(machineArg.value)};`);
      }
    }

    // Limitation - nothing actually gets returned in any regl generated function. We will not support return values here,
    // which can get quite complicated.
    // Limitation 2: Functions that cause another function call into the interpreter is not supported.
    interpreter.appendCode(`var _retobj = ${fn}(${argNames.join(', ')});`);
    interpreter.run();
  }

  function initFunc (interpreter, scope) {
    var proxy = interpreter.nativeToPseudo({});
    interpreter.setProperty(scope, 'proxy', proxy);

    var getWrapper = function get(path) {
      //console.log('interpreter: get', path);
      return JSON.stringify(getValue(JSON.parse(path)));
    }

    var setWrapper = function set(path, value) {
      //console.log('interpreter: set', path, value);
      setValue(JSON.parse(path), JSON.parse(value));
    }

    var callWrapper = function call_(path, args) {
      //console.log('interpreter: call', path, args);
      return JSON.stringify(call(JSON.parse(path), JSON.parse(args)));
    }

    var logWrapper = function log(...msg) {
      console.log("Inside machine: ", ...msg);
    }

    interpreter.setProperty(scope, 'getFromHeaven', interpreter.createNativeFunction(getWrapper));
    interpreter.setProperty(scope, 'sendToHeaven', interpreter.createNativeFunction(setWrapper));
    interpreter.setProperty(scope, 'prayToHeaven', interpreter.createNativeFunction(callWrapper));
    interpreter.setProperty(scope, 'log', interpreter.createNativeFunction(logWrapper));
  }

  function compile(linkedNames, linkedValues, code, procNames) {
    //console.log('compile', linkedNames, linkedValues, procNames);

    var linkBlock = ``;
    for (var i = 0; i < linkedNames.length; i++) {
      var name = linkedNames[i];
      var value = linkedValues[i];
      if (typeof value === 'object') {
        var key = `_global_${name}`;
        data[key] = value;
        //console.log("linking object", key, value);
        linkBlock += `var ${name} = linkHeavenlyObject(${JSON.stringify([key])}, ${JSON.stringify(getPropertyWatchlist(value))});\n`;
      } else if (typeof value === 'function') {
        var key = `_global_${name}`;
        data[key] = value;
        linkBlock += `var ${name} = linkHeavenlyFunction(${JSON.stringify([key])}, ${JSON.stringify(getPropertyWatchlist(value))});\n`;
      } else {
        linkBlock += `var ${name} = ${JSON.stringify(value)};\n`;
      }
    }

    //console.log('linkBlock', linkBlock);

    var result = {};
    // Capture references to "this" in regl.
    data["g_this"] = result;
    var thisPropRegex = /this\[['"]([^'"]+)['"]\]/g;
    
    var thisRegex = /\bthis\b/g;

    var thisProps = [];
    var match;
    while (match = thisPropRegex.exec(code)) {
      thisProps.push(match[1]);
    }
    
    linkBlock += `var g_this = linkHeavenlyObject(${JSON.stringify(['g_this'])}, ${JSON.stringify(thisProps)});\n`;
    code = code.replace(thisRegex, 'g_this');

    // Now put the code in the interpreter

    var fullCode = proxyHeader + linkBlock + code;

    window.fullCodes = window.fullCodes || [];
    window.fullCodes.push(fullCode);

    interpreter = new Interpreter(fullCode, initFunc);
    interpreter.run();

    for (var procName of procNames) {
      result[procName] = function () {
        callInMachine(procName, this, ...arguments);
      }
    }

    //console.log('compile result', result);
    return result;
  }


  return {
    callInMachine,
    compile
  }
}
