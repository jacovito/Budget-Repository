export function evaluateMoneyExpression(input: string): number | null {
  let source = input.trim().replace(/[$,\s]/g, "");
  if (source.startsWith("=")) source = source.slice(1);
  if (!source || source.length > 100 || !/^[0-9.+\-*/()]+$/.test(source)) return null;

  let cursor = 0;

  function parseExpression(): number {
    let value = parseTerm();
    while (source[cursor] === "+" || source[cursor] === "-") {
      const operator = source[cursor++];
      const next = parseTerm();
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (source[cursor] === "*" || source[cursor] === "/") {
      const operator = source[cursor++];
      const next = parseFactor();
      value = operator === "*" ? value * next : value / next;
    }
    return value;
  }

  function parseFactor(): number {
    if (source[cursor] === "+") {
      cursor += 1;
      return parseFactor();
    }
    if (source[cursor] === "-") {
      cursor += 1;
      return -parseFactor();
    }
    if (source[cursor] === "(") {
      cursor += 1;
      const value = parseExpression();
      if (source[cursor] !== ")") return Number.NaN;
      cursor += 1;
      return value;
    }

    const start = cursor;
    let dots = 0;
    while (cursor < source.length && /[0-9.]/.test(source[cursor])) {
      if (source[cursor] === ".") dots += 1;
      cursor += 1;
    }
    if (start === cursor || dots > 1) return Number.NaN;
    return Number(source.slice(start, cursor));
  }

  const result = parseExpression();
  if (cursor !== source.length || !Number.isFinite(result) || result < 0) return null;
  return Math.round((result + Number.EPSILON) * 100) / 100;
}
