import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Extension, Prec } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

const c = {
  foreground: "#D4D4D4",
  comment: "#6A9955",
  keyword: "#569CD6",
  controlKeyword: "#C586C0",
  string: "#CE9178",
  number: "#B5CEA8",
  regexp: "#D16969",
  regexpOperator: "#DCDCAA",
  escape: "#D7BA7D",
  variable: "#9CDCFE",
  constant: "#4FC1FF",
  function: "#DCDCAA",
  type: "#4EC9B0",
  tag: "#569CD6",
  cssTag: "#D7BA7D",
  invalid: "#F44747",
  punctuationTag: "#808080",
  markdownList: "#6796E6",
};

export const vscodeDarkModernSyntax: Extension = Prec.highest(
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.comment, color: c.comment },
      { tag: t.docComment, color: c.comment },

      { tag: t.keyword, color: c.keyword },
      { tag: t.controlKeyword, color: c.controlKeyword },
      { tag: t.operatorKeyword, color: c.keyword },
      { tag: t.moduleKeyword, color: c.keyword },
      { tag: t.definitionKeyword, color: c.keyword },
      { tag: t.modifier, color: c.keyword },
      { tag: t.self, color: c.keyword },
      { tag: t.null, color: c.keyword },
      { tag: t.atom, color: c.keyword },
      { tag: t.unit, color: c.number },

      { tag: t.operator, color: c.foreground },
      { tag: t.arithmeticOperator, color: c.foreground },
      { tag: t.bitwiseOperator, color: c.foreground },
      { tag: t.compareOperator, color: c.foreground },
      { tag: t.logicOperator, color: c.keyword },
      { tag: t.definitionOperator, color: c.foreground },
      { tag: t.derefOperator, color: c.foreground },
      { tag: t.updateOperator, color: c.foreground },

      { tag: t.string, color: c.string },
      { tag: t.docString, color: c.string },
      { tag: t.character, color: c.keyword },
      { tag: t.attributeValue, color: c.string },
      { tag: t.escape, color: c.escape },
      { tag: t.regexp, color: c.regexp },
      { tag: t.special(t.regexp), color: c.regexpOperator },

      { tag: t.number, color: c.number },
      { tag: t.integer, color: c.number },
      { tag: t.float, color: c.number },
      { tag: t.bool, color: c.keyword },
      { tag: t.literal, color: c.number },
      { tag: t.color, color: c.string },

      { tag: t.variableName, color: c.variable },
      { tag: t.definition(t.variableName), color: c.variable },
      { tag: t.local(t.variableName), color: c.variable },
      { tag: t.special(t.variableName), color: c.variable },
      { tag: t.constant(t.variableName), color: c.constant },
      { tag: t.standard(t.variableName), color: c.variable },
      { tag: t.propertyName, color: c.variable },
      { tag: t.definition(t.propertyName), color: c.variable },
      { tag: t.attributeName, color: c.variable },

      { tag: t.function(t.variableName), color: c.function },
      { tag: t.definition(t.function(t.variableName)), color: c.function },
      { tag: t.function(t.propertyName), color: c.function },
      { tag: t.macroName, color: c.function },

      { tag: t.typeName, color: c.type },
      { tag: t.className, color: c.type },
      { tag: t.namespace, color: c.type },
      { tag: t.tagName, color: c.tag },
      { tag: t.standard(t.tagName), color: c.cssTag },

      { tag: t.angleBracket, color: c.punctuationTag },
      { tag: t.punctuation, color: c.foreground },
      { tag: t.separator, color: c.foreground },
      { tag: t.bracket, color: c.foreground },

      { tag: t.meta, color: c.keyword },
      { tag: t.processingInstruction, color: c.keyword },
      { tag: t.labelName, color: "#C8C8C8" },

      { tag: t.heading, color: c.keyword, fontWeight: "bold" },
      { tag: t.strong, color: c.keyword, fontWeight: "bold" },
      { tag: t.emphasis, color: c.controlKeyword, fontStyle: "italic" },
      { tag: t.link, color: c.markdownList },
      { tag: t.url, color: c.string },

      { tag: t.invalid, color: c.invalid },
    ]),
  ),
);
