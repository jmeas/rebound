define("handlebars/compiler/compiler", 
  ["../exception","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Exception = __dependency1__["default"];

    function Compiler() {}

    __exports__.Compiler = Compiler;// the foundHelper register will disambiguate helper lookup from finding a
    // function in a context. This is necessary for mustache compatibility, which
    // requires that context functions in blocks are evaluated by blockHelperMissing,
    // and then proceed as if the resulting value was provided to blockHelperMissing.

    Compiler.prototype = {
      compiler: Compiler,

      disassemble: function() {
        var opcodes = this.opcodes, opcode, out = [], params, param;

        for (var i=0, l=opcodes.length; i<l; i++) {
          opcode = opcodes[i];

          if (opcode.opcode === 'DECLARE') {
            out.push("DECLARE " + opcode.name + "=" + opcode.value);
          } else {
            params = [];
            for (var j=0; j<opcode.args.length; j++) {
              param = opcode.args[j];
              if (typeof param === "string") {
                param = "\"" + param.replace("\n", "\\n") + "\"";
              }
              params.push(param);
            }
            out.push(opcode.opcode + " " + params.join(" "));
          }
        }

        return out.join("\n");
      },

      equals: function(other) {
        var len = this.opcodes.length;
        if (other.opcodes.length !== len) {
          return false;
        }

        for (var i = 0; i < len; i++) {
          var opcode = this.opcodes[i],
              otherOpcode = other.opcodes[i];
          if (opcode.opcode !== otherOpcode.opcode || opcode.args.length !== otherOpcode.args.length) {
            return false;
          }
          for (var j = 0; j < opcode.args.length; j++) {
            if (opcode.args[j] !== otherOpcode.args[j]) {
              return false;
            }
          }
        }

        len = this.children.length;
        if (other.children.length !== len) {
          return false;
        }
        for (i = 0; i < len; i++) {
          if (!this.children[i].equals(other.children[i])) {
            return false;
          }
        }

        return true;
      },

      guid: 0,

      compile: function(program, options) {
        this.opcodes = [];
        this.children = [];
        this.depths = {list: []};
        this.options = options;
        this.stringParams = options.stringParams;
        this.trackIds = options.trackIds;

        // These changes will propagate to the other compiler components
        var knownHelpers = this.options.knownHelpers;
        this.options.knownHelpers = {
          'helperMissing': true,
          'blockHelperMissing': true,
          'each': true,
          'if': true,
          'unless': true,
          'with': true,
          'log': true,
          'lookup': true
        };
        if (knownHelpers) {
          for (var name in knownHelpers) {
            this.options.knownHelpers[name] = knownHelpers[name];
          }
        }

        return this.accept(program);
      },

      accept: function(node) {
        var strip = node.strip || {},
            ret;
        if (strip.left) {
          this.opcode('strip');
        }

        ret = this[node.type](node);

        if (strip.right) {
          this.opcode('strip');
        }

        return ret;
      },

      program: function(program) {
        var statements = program.statements;

        for(var i=0, l=statements.length; i<l; i++) {
          this.accept(statements[i]);
        }
        this.isSimple = l === 1;

        this.depths.list = this.depths.list.sort(function(a, b) {
          return a - b;
        });

        return this;
      },

      compileProgram: function(program) {
        var result = new this.compiler().compile(program, this.options);
        var guid = this.guid++, depth;

        this.usePartial = this.usePartial || result.usePartial;

        this.children[guid] = result;

        for(var i=0, l=result.depths.list.length; i<l; i++) {
          depth = result.depths.list[i];

          if(depth < 2) { continue; }
          else { this.addDepth(depth - 1); }
        }

        return guid;
      },

      block: function(block) {
        var mustache = block.mustache,
            program = block.program,
            inverse = block.inverse;

        if (program) {
          program = this.compileProgram(program);
        }

        if (inverse) {
          inverse = this.compileProgram(inverse);
        }

        var sexpr = mustache.sexpr;
        var type = this.classifySexpr(sexpr);

        if (type === "helper") {
          this.helperSexpr(sexpr, program, inverse);
        } else if (type === "simple") {
          this.simpleSexpr(sexpr);

          // now that the simple mustache is resolved, we need to
          // evaluate it by executing `blockHelperMissing`
          this.opcode('pushProgram', program);
          this.opcode('pushProgram', inverse);
          this.opcode('emptyHash');
          this.opcode('blockValue', sexpr.id.original);
        } else {
          this.ambiguousSexpr(sexpr, program, inverse);

          // now that the simple mustache is resolved, we need to
          // evaluate it by executing `blockHelperMissing`
          this.opcode('pushProgram', program);
          this.opcode('pushProgram', inverse);
          this.opcode('emptyHash');
          this.opcode('ambiguousBlockValue');
        }

        this.opcode('append');
      },

      hash: function(hash) {
        var pairs = hash.pairs, i, l;

        this.opcode('pushHash');

        for(i=0, l=pairs.length; i<l; i++) {
          this.pushParam(pairs[i][1]);
        }
        while(i--) {
          this.opcode('assignToHash', pairs[i][0]);
        }
        this.opcode('popHash');
      },

      partial: function(partial) {
        var partialName = partial.partialName;
        this.usePartial = true;

        if (partial.hash) {
          this.accept(partial.hash);
        } else {
          this.opcode('push', 'undefined');
        }

        if (partial.context) {
          this.accept(partial.context);
        } else {
          this.opcode('push', 'depth0');
        }

        this.opcode('invokePartial', partialName.name);
        this.opcode('append');
      },

      content: function(content) {
        this.opcode('appendContent', content.string);
      },

      mustache: function(mustache) {
        this.sexpr(mustache.sexpr);

        if(mustache.escaped && !this.options.noEscape) {
          this.opcode('appendEscaped');
        } else {
          this.opcode('append');
        }
      },

      ambiguousSexpr: function(sexpr, program, inverse) {
        var id = sexpr.id,
            name = id.parts[0],
            isBlock = program != null || inverse != null;

        this.opcode('getContext', id.depth);

        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);

        this.opcode('invokeAmbiguous', name, isBlock);
      },

      simpleSexpr: function(sexpr) {
        var id = sexpr.id;

        if (id.type === 'DATA') {
          this.DATA(id);
        } else if (id.parts.length) {
          this.ID(id);
        } else {
          // Simplified ID for `this`
          this.addDepth(id.depth);
          this.opcode('getContext', id.depth);
          this.opcode('pushContext');
        }

        this.opcode('resolvePossibleLambda');
      },

      helperSexpr: function(sexpr, program, inverse) {
        var params = this.setupFullMustacheParams(sexpr, program, inverse),
            id = sexpr.id,
            name = id.parts[0];

        if (this.options.knownHelpers[name]) {
          this.opcode('invokeKnownHelper', params.length, name);
        } else if (this.options.knownHelpersOnly) {
          throw new Exception("You specified knownHelpersOnly, but used the unknown helper " + name, sexpr);
        } else {
          this.ID(id);
          this.opcode('invokeHelper', params.length, id.original, sexpr.isRoot);
        }
      },

      sexpr: function(sexpr) {
        var type = this.classifySexpr(sexpr);

        if (type === "simple") {
          this.simpleSexpr(sexpr);
        } else if (type === "helper") {
          this.helperSexpr(sexpr);
        } else {
          this.ambiguousSexpr(sexpr);
        }
      },

      ID: function(id) {
        this.addDepth(id.depth);
        this.opcode('getContext', id.depth);

        var name = id.parts[0];
        if (!name) {
          this.opcode('pushContext');
        } else {
          this.opcode('lookupOnContext', id.parts[0]);
        }

        for(var i=1, l=id.parts.length; i<l; i++) {
          this.opcode('lookup', id.parts[i]);
        }
      },

      DATA: function(data) {
        this.options.data = true;
        this.opcode('lookupData', data.id.depth);
        var parts = data.id.parts;
        for(var i=0, l=parts.length; i<l; i++) {
          this.opcode('lookup', parts[i]);
        }
      },

      STRING: function(string) {
        this.opcode('pushString', string.string);
      },

      NUMBER: function(number) {
        this.opcode('pushLiteral', number.number);
      },

      BOOLEAN: function(bool) {
        this.opcode('pushLiteral', bool.bool);
      },

      comment: function() {},

      // HELPERS
      opcode: function(name) {
        this.opcodes.push({ opcode: name, args: [].slice.call(arguments, 1) });
      },

      declare: function(name, value) {
        this.opcodes.push({ opcode: 'DECLARE', name: name, value: value });
      },

      addDepth: function(depth) {
        if(depth === 0) { return; }

        if(!this.depths[depth]) {
          this.depths[depth] = true;
          this.depths.list.push(depth);
        }
      },

      classifySexpr: function(sexpr) {
        var isHelper   = sexpr.isHelper;
        var isEligible = sexpr.eligibleHelper;
        var options    = this.options;

        // if ambiguous, we can possibly resolve the ambiguity now
        // An eligible helper is one that does not have a complex path, i.e. `this.foo`, `../foo` etc.
        if (isEligible && !isHelper) {
          var name = sexpr.id.parts[0];

          if (options.knownHelpers[name]) {
            isHelper = true;
          } else if (options.knownHelpersOnly) {
            isEligible = false;
          }
        }

        if (isHelper) { return "helper"; }
        else if (isEligible) { return "ambiguous"; }
        else { return "simple"; }
      },

      pushParams: function(params) {
        for(var i=0, l=params.length; i<l; i++) {
          this.pushParam(params[i]);
        }
      },

      pushParam: function(val) {
        if (this.stringParams) {
          if(val.depth) {
            this.addDepth(val.depth);
          }
          this.opcode('getContext', val.depth || 0);
          this.opcode('pushStringParam', val.stringModeValue, val.type);

          if (val.type === 'sexpr') {
            // Subexpressions get evaluated and passed in
            // in string params mode.
            this.sexpr(val);
          }
        } else {
          if (this.trackIds) {
            this.opcode('pushId', val.type, val.idName || val.stringModeValue);
          }
          this.accept(val);
        }
      },

      setupFullMustacheParams: function(sexpr, program, inverse) {
        var params = sexpr.params;
        this.pushParams(params);

        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);

        if (sexpr.hash) {
          this.hash(sexpr.hash);
        } else {
          this.opcode('emptyHash');
        }

        return params;
      }
    };

    function precompile(input, options, env) {
      if (input == null || (typeof input !== 'string' && input.constructor !== env.AST.ProgramNode)) {
        throw new Exception("You must pass a string or Handlebars AST to Handlebars.precompile. You passed " + input);
      }

      options = options || {};
      if (!('data' in options)) {
        options.data = true;
      }

      var ast = env.parse(input);
      var environment = new env.Compiler().compile(ast, options);
      return new env.JavaScriptCompiler().compile(environment, options);
    }

    __exports__.precompile = precompile;function compile(input, options, env) {
      if (input == null || (typeof input !== 'string' && input.constructor !== env.AST.ProgramNode)) {
        throw new Exception("You must pass a string or Handlebars AST to Handlebars.compile. You passed " + input);
      }

      options = options || {};

      if (!('data' in options)) {
        options.data = true;
      }

      var compiled;

      function compileInput() {
        var ast = env.parse(input);
        var environment = new env.Compiler().compile(ast, options);
        var templateSpec = new env.JavaScriptCompiler().compile(environment, options, undefined, true);
        return env.template(templateSpec);
      }

      // Template is only compiled on first use and cached after that point.
      var ret = function(context, options) {
        if (!compiled) {
          compiled = compileInput();
        }
        return compiled.call(this, context, options);
      };
      ret._setup = function(options) {
        if (!compiled) {
          compiled = compileInput();
        }
        return compiled._setup(options);
      };
      ret._child = function(i) {
        if (!compiled) {
          compiled = compileInput();
        }
        return compiled._child(i);
      };
      return ret;
    }

    __exports__.compile = compile;
  });