"use strict";
var usesMorph = require("../ast").usesMorph;
var buildText = require("../builders").buildText;
var buildString = require("../builders").buildString;
var buildHash = require("../builders").buildHash;
var buildPair = require("../builders").buildPair;
var buildSexpr = require("../builders").buildSexpr;
var buildPath = require("../builders").buildPath;

// Rewrites an array of AttrNodes into a HashNode.
// MustacheNodes are replaced with their root SexprNode and
// TextNodes are replaced with StringNodes

function buildHashFromAttributes(attributes) {
  var pairs = [];

  for (var i = 0; i < attributes.length; i++) {
    var attr = attributes[i];
    var value;
    if (attr.value.type === 'SubExpression') {
      value = attr.value;
    } else if (attr.value.type === 'TextNode') {
      value = buildString(attr.value.chars);
    } else {
      value = buildSexpr(buildPath('concat'), attr.value);
    }

    pairs.push(buildPair(attr.name, value));
  }

  return buildHash(pairs);
}

exports.buildHashFromAttributes = buildHashFromAttributes;// Checks the component's attributes to see if it uses block params.
// If it does, registers the block params with the program and
// removes the corresponding attributes from the element.

function parseComponentBlockParams(element, program) {
  var l = element.attributes.length;
  var attrNames = [];

  for (var i = 0; i < l; i++) {
    attrNames.push(element.attributes[i].name);
  }

  var asIndex = attrNames.indexOf('as');

  if (asIndex !== -1 && l > asIndex && attrNames[asIndex + 1].charAt(0) === '|') {
    // Some basic validation, since we're doing the parsing ourselves
    var paramsString = attrNames.slice(asIndex).join(' ');
    if (paramsString.charAt(paramsString.length - 1) !== '|' || paramsString.match(/\|/g).length !== 2) {
      throw new Error('Invalid block parameters syntax: \'' + paramsString + '\'');
    }

    var params = [];
    for (i = asIndex + 1; i < l; i++) {
      var param = attrNames[i].replace('|', '');
      if (param !== '') {
        params.push(param);
      }
    }

    element.attributes = element.attributes.slice(0, asIndex);
    program.blockParams = params;
  }
}

exports.parseComponentBlockParams = parseComponentBlockParams;// Adds an empty text node at the beginning and end of a program.
// The empty text nodes *between* nodes are handled elsewhere.
// Also processes all whitespace stripping directives.

function postprocessProgram(program) {
  var body = program.body;

  if (body.length === 0) {
    return;
  }

  if (usesMorph(body[0])) {
    body.unshift(buildText(''));
  }

  if (usesMorph(body[body.length-1])) {
    body.push(buildText(''));
  }

  // Perform any required whitespace stripping
  var l = body.length;
  for (var i = 0; i < l; i++) {
    var statement = body[i];

    if (statement.type !== 'TextNode') {
      continue;
    }

    // if ((i > 0 && body[i-1].strip && body[i-1].strip.right) ||
    //   (i === 0 && program.strip.left)) {
    //   statement.chars = statement.chars.replace(/^\s+/, '');
    // }

    // if ((i < l-1 && body[i+1].strip && body[i+1].strip.left) ||
    //   (i === l-1 && program.strip.right)) {
    //   statement.chars = statement.chars.replace(/\s+$/, '');
    // }

    // Remove unnecessary text nodes
    if (statement.chars.length === 0) {
      if ((i > 0 && body[i-1].type === 'ElementNode') ||
        (i < l-1 && body[i+1].type === 'ElementNode')) {
        body.splice(i, 1);
        i--;
        l--;
      }
    }
  }
}

exports.postprocessProgram = postprocessProgram;