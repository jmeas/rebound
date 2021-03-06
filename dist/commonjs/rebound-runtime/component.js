"use strict";
var $ = require("rebound-runtime/utils")["default"];
var env = require("rebound-runtime/env")["default"];
var Model = require("rebound-data/rebound-data").Model;
var Collection = require("rebound-data/rebound-data").Collection;
var ComputedProperty = require("rebound-data/rebound-data").ComputedProperty;


// If Rebound Runtime has already been run, throw error
if(Rebound.Component){
  throw 'Rebound is already loaded on the page!';
}
// If Backbone hasn't been started yet, throw error
if(!window.Backbone){
  throw "Backbone must be on the page for Rebound to load.";
}

// New Backbone Component
var Component = Model.extend({

  isComponent: true,

  constructor: function(options){
    options = options || (options = {});
    _.bindAll(this, '_onModelChange', '_onCollectionChange', '__callOnComponent', '_notifySubtree');
    this.cid = _.uniqueId('component');
    this.attributes = {};
    this.changed = {};
    this.helpers = {};
    this.__parent__ = this.__root__ = this;


    // Take our parsed data and add it to our backbone data structure. Does a deep defaults set.
    // In the model, primatives (arrays, objects, etc) are converted to Backbone Objects
    // Functions are compiled to find their dependancies and registerd as compiled properties
    _.each(this.defaults, function(val){
      if(val && (val.isModel || val.isCollection)){
        val.__parent__ = this;
        val.__root__ = this;
      }
    }, this);


    // Set our component's context with the passed data merged with the component's defaults
    this.set((this.defaults || {}));
    this.set((options.data || {}));


    // Call on component is used by the {{on}} helper to call all event callbacks in the scope of the component
    this.helpers.__callOnComponent = this.__callOnComponent;


    // Get any additional routes passed in from options
    this.routes =  _.defaults((options.routes || {}), this.routes);
    // Ensure that all route functions exist
    _.each(this.routes, function(value, key, routes){
        if(typeof value !== 'string'){ throw('Function name passed to routes in  ' + this.__name + ' component must be a string!'); }
        if(!this[value]){ throw('Callback function '+value+' does not exist on the  ' + this.__name + ' component!'); }
    }, this);


    // Set our outlet and template if we have one
    this.el = options.outlet || undefined;
    this.$el = (_.isUndefined(window.Backbone.$)) ? false : window.Backbone.$(this.el);

    if(_.isFunction(this.createdCallback)){
      this.createdCallback.call(this);
    }

    // Take our precompiled template and hydrates it. When Rebound Compiler is included, can be a handlebars template string.
    if(!options.template && !this.template){ throw('Template must provided for ' + this.__name + ' component!'); }
    this.template = options.template || this.template;
    this.template = (typeof options.template === 'string') ? Rebound.templates[this.template] : env.hydrate(this.template);


    // Listen to relevent data change events
    this.listenTo(this, 'change', this._onModelChange);
    this.listenTo(this, 'add remove', this._onCollectionChange);
    this.listenTo(this, 'reset', this._onReset);


    // Render our dom and place the dom in our custom element
    this.el.appendChild(this.template(this, {helpers: this.helpers}, this.el));

  },

  $: function(selector) {
    if(!this.$el){
      return console.error('No DOM manipulation library on the page!');
    }
    return this.$el.find(selector);
  },

  // Trigger all events on both the component and the element
  trigger: function(eventName){
    if(this.el){
      $(this.el).trigger(eventName, arguments);
    }
    Backbone.Model.prototype.trigger.apply(this, arguments);
  },

  __callOnComponent: function(name, event){
    if(!_.isFunction(this[name])){ throw "ERROR: No method named " + name + " on component " + this.__name + "!"; }
    return this[name].call(this, event);
  },

  _onAttributeChange: function(attrName, oldVal, newVal){
    try{ newVal = JSON.parse(newVal); } catch (e){ newVal = newVal; }

    // data attributes should be referanced by their camel case name
    attrName = attrName.replace(/^data-/g, "").replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });

    oldVal = this.get(attrName);

    if(newVal === null){ this.unset(attrName); }

    // If oldVal is a number, and newVal is only numerical, preserve type
    if(_.isNumber(oldVal) && _.isString(newVal) && newVal.match(/^[0-9]*$/i)){
      newVal = parseInt(newVal);
    }

    else{ this.set(attrName, newVal, {quiet: true}); }
  },

  _onReset: function(data, options){
    if(data && data.isModel){
      return this._onModelChange(data, options);
    }
    else if(data.isCollection){
      return this._onCollectionChange(data, options);
    }
  },

  _onModelChange: function(model, options){
    // console.error('Model change', model.changedAttributes(), model );
    var changed = model.changedAttributes();
    if(changed){
      this._notifySubtree(model, changed, 'model');
    }
  },

  _onCollectionChange: function(model, collection, options){
    // console.error('Collection change', model, collection);

    var changed = {},
        that = this;
    if(model.isCollection){
      options = collection;
      collection = model;
    }

    changed[collection.__path()] = collection;
    if(collection._timeout){
      clearTimeout(collection._timeout);
      collection._timeout = undefined;
    }
    collection._timeout = setTimeout(function(){
      that._notifySubtree(that, changed, 'collection');
    }, 20);
  },

  _notifySubtree: function(obj, changed, type){

    var context = this, // This root context
        path = obj.__path(), // The path of the modified object relative to the root context
        parts = $.splitPath(path), // Array of parts of the modified object's path: test[1].whatever -> ['test', '1', 'whatever']
        keys = _.keys(changed), // Array of all changed keys
        i = 0,
        len = parts.length,
        paths,
        triggers;

    // Call notify on every object down the data tree starting at the root and all the way down element that triggered the change
    for(i;i<=len;i++){

      // Reset paths for each data layer
      paths = [];
      triggers = [];

      // For every key changed
      _.each(keys, function(attr){

        // Constructs paths variable relative to current data element
        paths.push(((path && path + '.' || '') + attr).replace(context.__path(), '').replace(/\[([^\]]+)\]/g, ".$1").replace(/^\./, ''));
        paths.push(((path && path + '.' || '') + attr).replace(context.__path(), '').replace(/\[[^\]]+\]/g, ".@each").replace(/^\./, ''));
        paths = _.uniq(paths);
      });

      // Call all listeners
      env.notify(context, paths, type);

      // If not at end of path parts, get the next data object
      context = (i === len) || (context.isModel && context.get(parts[i])) || (context.isCollection && context.at(parts[i]));
      if(context === undefined){
        break;
      }
    }
  }
});

Component.extend= function(protoProps, staticProps) {
  var parent = this,
      child,
      reservedMethods = {'trigger':1, 'constructor':1, 'get':1, 'set':1, 'has':1, 'extend':1, 'escape':1, 'unset':1, 'clear':1, 'cid':1, 'attributes':1, 'changed':1, 'toJSON':1, 'validationError':1, 'isValid':1, 'isNew':1, 'hasChanged':1, 'changedAttributes':1, 'previous':1, 'previousAttributes':1},
      configProperties = {'routes':1, 'template':1, 'defaults':1, 'outlet':1, 'url':1, 'urlRoot':1, 'idAttribute':1, 'id':1, 'createdCallback':1, 'attachedCallback':1, 'detachedCallback':1};

  protoProps.defaults = {};

  console.log(protoProps, staticProps);

  // For each property passed into our component base class
  _.each(protoProps, function(value, key, protoProps){

    // If a configuration property, ignore it
    if(configProperties[key]){ return; }

    // If a primative or backbone type object, or computed property (function which takes no arguments and returns a value) move it to our defaults
    if(!_.isFunction(value) || value.isModel || value.isComponent || (_.isFunction(value) && value.length === 0 && value.toString().indexOf('return') > -1)){
      protoProps.defaults[key] = value;
      delete protoProps[key];
    }

    // If a reserved method, yell
    if(reservedMethods[key]){ throw "ERROR: " + key + " is a reserved method name in " + staticProps.__name + "!"; }

    // All other values are component methods, leave them be unless already defined.

  }, this);

  // If given a constructor, use it, otherwise use the default one defined above
  if (protoProps && _.has(protoProps, 'constructor')) {
    child = protoProps.constructor;
  } else {
    child = function(){ return parent.apply(this, arguments); };
  }

  // Our class should inherit everything from its parent, defined above
  var Surrogate = function(){ this.constructor = child; };
  Surrogate.prototype = parent.prototype;
  child.prototype = new Surrogate();

  // Extend our prototype with any remaining protoProps, overriting pre-defined ones
  if (protoProps){ _.extend(child.prototype, protoProps, staticProps); }

  // Set our ancestry
  child.__super__ = parent.prototype;

  return child;
};


exports["default"] = Component;