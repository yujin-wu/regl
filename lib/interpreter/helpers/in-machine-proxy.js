
var P = require('./proxyPolyfill');
var proxyPolyfill = P.proxyPolyfill;


// Now create the in-machine proxy.

module.exports = {
  proxyHeader: `
// function getFromHeaven(path) { };
// function sendToHeaven(path, value) { };
// function prayToHeaven(path, args) { };
// function log(msg) { };
${proxyPolyfill.replace(/\n/g, ' ')}

// "polyfill" for Float32Array
function Float32Array(length) {
  var arr = new Array(length);
  for (var i = 0; i < length; i++) {
    arr[i] = 0;
  }
  return arr;
}

function linkHeavenlyObject(path, keys, isFunction) {
  log('linkHeavenlyObject', JSON.stringify(path), JSON.stringify(keys), isFunction);
  var obj = {};
  if (isFunction) {
    obj = function() {
    }
  }
  for (var i = 0; i < keys.length; i++) {
    obj[keys[i]] = undefined;
  }

  var proxy = {
    get: function(target, name) {
      //log("getting", JSON.stringify(path), JSON.stringify(name));
      var val = JSON.parse(getFromHeaven(JSON.stringify(path.concat(name))));
      //log("got", JSON.stringify(path), JSON.stringify(name), JSON.stringify(val));

      if (val.type === 'object') {
        return linkHeavenlyObject(path.concat(name), val.keys);
      } else if (val.type === 'function') {
        return linkHeavenlyFunction(path.concat(name), val.keys);
      } else {
        return val.value;
      }
    },
    set: function(target, name, value) {
      //log("setting", JSON.stringify(path), JSON.stringify(name), typeof value);
      if (typeof value === 'object' && value !== null) {
        //log("setting", value.__isHeavenlyObject);
      }
      var toSend;
      if (typeof value === 'object' && value !== null && value.__isHeavenlyObject) {
        toSend = JSON.stringify({
          type: 'object',
          path: value.__path,
        });
      } else if (typeof value === 'function') {
        toSend = JSON.stringify({
          type: 'function',
          path: value.__path,
        });
      } else {
        toSend = JSON.stringify({
          type: 'primitive',
          value: value,
        });
      }
      sendToHeaven(JSON.stringify(path.concat(name)), toSend);
    },
  };

  if (isFunction) {
    proxy.apply = function(target, thisArg, args) {
      log("running", JSON.stringify(path));
      var args = prepareArguments(args);
      var ret = JSON.parse(prayToHeaven(JSON.stringify(path), JSON.stringify(args)));
      log("ran", JSON.stringify(path), JSON.stringify(args), "got", JSON.stringify(ret));
      if (ret.type === 'object') {
        return linkHeavenlyObject(ret.path, ret.keys);
      } else if (ret.type === 'function') {
        return linkHeavenlyFunction(ret.path, ret.keys);
      } else {
        return ret.value;
      }
    }
  }
  var result = new Proxy(obj, proxy);

  // Add these two props after creating the proxy so they don't go through the mechanism.
  // Recall that a limitation of this proxy is that it can only use properties that exist initially.
  // We use that to our advantage here actually.
 
  result.__isHeavenlyObject = true;
  result.__path = path;
  //log("linked", JSON.stringify(path), JSON.stringify(keys));
  return result;
}

function prepareArguments(args) {
  // log('prepareArguments', JSON.stringify(args));
  args = [].concat(args);
  return args.map(function (arg) {
    //log("preparing arg", arg);
    if ((typeof arg === 'object' || typeof arg === 'function') && arg !== null) {
      if (arg.__isHeavenlyObject) {
        return {
          type: 'object',
          path: arg.__path,
        };
      } else {
        return {
          type: 'object-literal',
          value: JSON.stringify(arg),
        };
      }
    } else {
      return {
        type: 'primitive',
        value: arg,
      };
    }
  });
}

function linkHeavenlyFunction(path, keys) {
  //log('linkHeavenlyFunction', JSON.stringify(path));
  return linkHeavenlyObject(path, keys, true);
}

// Now test it.

// var obj = linkHeavenlyObject(['test_obj'], ['a', 'b', 'c', 'log']);

// log(obj.a);
// obj.a = 'a';
// log(obj.a);
// obj.b = obj.c.d;
// log(obj.b);
// log(obj.c.d);
// obj.c.d = 'd';
// log(obj.c.d);
// obj.a = obj.c;
// obj.log("hello");
// obj.log("world");
// obj.log(obj);

`};