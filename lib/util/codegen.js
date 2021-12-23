var extend = require('./extend')
var precompiled = require('./precompiled')
const getCircularReplacer = require('./getCircularReplacer')

function slice (x) {
  return Array.prototype.slice.call(x)
}

function join (x) {
  return slice(x).join('')
}

module.exports = function createEnvironment (debug) {
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
