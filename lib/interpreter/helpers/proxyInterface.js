
var acorn = require('../acorn');
global.acorn = acorn;
var {Interpreter} = require('../interpreter');
// var { proxyHeader } = require('./in-machine-proxy');

// GLOSSARY
// native object - an object that exists in the host JS environment and is rigged in the interpreted environment.
// interpreter object - an object that exists in the interpreted environment only.

// LIMITATIONS:
// arguments from interpreter to real that are interpreter objects are not supported.
// Invoking an interpreter function using callInMachine does not produce a return value.


// MAYBE we have to extend it where we pass in the path of object return values to 
// the machine if the object is the same as one that's already stored, to satisfy
// equality with objects in the machine.
module.exports.createInterpreterEnvironment = function () {
  var data = {};
  var objCnt = 0;

  function getValue(path) {
    var rawValue = this.getRawValue(path);
    return rawToMachine(rawValue, path);
  }

  function getRawValue(path) {
    var current = data;
    for (var i = 0; i < path.length; i++) {
      current = current[path[i]];
    }
    return current;
  };

  function setValue(path, value) {
    var rawValue = machineToRaw(value);
    setRawValue(path, rawValue);
  }

  function setRawValue(path, value) {
    var current = data;
    for (var i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
  }

  function call(path, args) {
    var rawArgs = args.map(arg => machineToRaw(arg));
    var fn = getRawValue(path);
    if (typeof fn !== 'function') {
      throw new Error('Not a function');
    }
    var raw = fn(...rawArgs);
    if (typeof raw === 'object' || typeof raw === 'function') {
      var newPath = ['_retobj' + objCnt++];
      setRawValue(newPath, raw);
      return rawToMachine(raw, newPath);
    }
    return rawToMachine(raw, path);
  }

  function rawToMachine(rawValue, path) {
    switch (typeof rawValue) {
      case 'object':
        if (rawValue !== null) { // if it is null, we let it fall down as a primitive below.
          return {
            type: 'object',
            path,
            keys: Object.keys(rawValue),
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
          keys: Object.keys(rawValue).concat(Object.keys(rawValue.prototype)),
        };
      default:
        throw new Error('Unknown type: ' + typeof current);
    }
  }

  //machineToRaw: function(machineValue) {
  function machineToRaw(machineValue) {
    switch (machineValue.type) {
      case 'primitive':
        return machineValue.value;
      case 'object':
      case 'function':
        return this.getRawValue(machineValue.path);
      default:
        throw new Error('Unknown type: ' + machineValue.type);
    }
  }

  // TODO: memory cleanup
  function callInMachine(fn, rawArgs) {
    var machineArgs = rawArgs.map(arg => {
      if (typeof arg === 'object') {
        var key = '_argobj' + objCnt++;
        data[key] = arg;
        return {
          type: 'object',
          path: [key],
          keys: Object.keys(arg).concat(Object.keys(arg.prototype)),
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

    for (var machineArg of machineArgs) {
      if (machineArg.type === 'object') {
        interpreter.appendCode(`var ${machineArg.path.join('_')} = linkHeavenlyObject(${JSON.stringify(machineArgs.path)}, ${JSON.stringify(machineArgs.keys)});`);
      } else if (machineArg.type === 'function') {
        interpreter.appendCode(`var ${machineArg.path.join('_')} = linkHeavenlyFunction(${JSON.stringify(machineArgs.path)});`);
      } else {
        interpreter.appendCode(`var ${machineArg.path.join('_')} = ${JSON.stringify(machineArg.value)};`);
      }
    }

    // Limitation - nothing actually gets returned in any regl generated function. We will not support return values here,
    // which can get quite complicated.
    interpreter.appendCode(`var _retobj = ${fn}(${machineArgs.map(arg => arg.path.join('_')).join(', ')});`);
    interpreter.run();
  }

  function initFunc (interpreter, scope) {
    var proxy = interpreter.nativeToPseudo({});
    interpreter.setProperty(scope, 'proxy', proxy);

    var getWrapper = function get(path) {
      //console.log('get', path);
      return JSON.stringify(getValue(JSON.parse(path)));
    }

    var setWrapper = function set(path, value) {
      //console.log('set', path, value);
      setValue(JSON.parse(path), JSON.parse(value));
    }

    var callWrapper = function call(path, args) {
      //console.log('call', path, args);
      return JSON.stringify(call(JSON.parse(path), JSON.parse(args)));
    }

    var logWrapper = function log(...msg) {
      console.log(...msg);
    }

    interpreter.setProperty(scope, 'getFromHeaven', interpreter.createNativeFunction(getWrapper));
    interpreter.setProperty(scope, 'sendToHeaven', interpreter.createNativeFunction(setWrapper));
    interpreter.setProperty(scope, 'prayToHeaven', interpreter.createNativeFunction(callWrapper));
    interpreter.setProperty(scope, 'log', interpreter.createNativeFunction(logWrapper));
  }

  function compile(linkedNames, linkedValues, code, procNames) {

    var linkBlock = ``;
    for (var i = 0; i < linkedNames.length; i++) {
      var name = linkedNames[i];
      var value = linkedValues[i];
      if (typeof value === 'object') {
        var key = `_global_${name}`;
        data[key] = value;
        linkBlock += `var ${name} = linkHeavenlyObject(${JSON.stringify([key])}, ${JSON.stringify(Object.keys(values).concat(Object.keys(value.prototype)))});\n`;
      } else if (typeof value === 'function') {
        var key = `_global_${name}`;
        data[key] = value;
        linkBlock += `var ${name} = linkHeavenlyFunction(${JSON.stringify([key])});\n`;
      } else {
        linkBlock += `var ${name} = ${JSON.stringify(value)};\n`;
      }
    }

    var interpreter = new Interpreter(proxyHeader + linkBlock + code, initFunc);
    interpreter.run();

    var result = {};
    for (var procName of procNames) {
      result[procName] = function () {
        callInMachine(procName, ...arguments);
      }
    }
    return result;
  }


  return {
    callInMachine,
    compile
  }
}

