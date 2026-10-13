"use strict";

const STOP = new Set(["the", "and", "for", "with", "of", "in", "a", "an", "new", "free", "delivery", "kenya", "best", "quality", "pcs", "pc"]);

function tokens(value) {
  return String(value || "").toLowerCase()
    .replace(/(\d)\s*(l|ltr|litres?|liters?)\b/g, "$1l")
    .replace(/(\d)\s*(w|watts?)\b/g, "$1w")
    .replace(/(\d)\s*(gb|tb|mah|inch|in|cm|mm|kg|g|ml)\b/g, "$1$2")
    .replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter(token => token && !STOP.has(token));
}

const hasDigit = token => /\d/.test(token);

function score(query, candidateTitle) {
  const queryTokens = tokens(query);
  const candidateTokens = new Set(tokens(candidateTitle));
  if (!queryTokens.length || !candidateTokens.size) return { similarity: 0, specsMatch: false, brandMatch: false };
  const hits = queryTokens.filter(token => candidateTokens.has(token)).length;
  const specifications = queryTokens.filter(hasDigit);
  return {
    similarity: hits / queryTokens.length,
    specsMatch: specifications.length > 0 && specifications.every(token => candidateTokens.has(token)),
    brandMatch: candidateTokens.has(queryTokens[0]),
  };
}

function matchRank(query, title) {
  const result = score(query, title);
  return result.similarity + (result.specsMatch ? 0.2 : 0) + (result.brandMatch ? 0.1 : 0);
}

function classify(query, candidate) {
  if (!candidate) return "Not found";
  const result = score(query, candidate.title);
  if (result.similarity >= 0.7 && result.specsMatch && result.brandMatch) return "High-confidence equivalent";
  if (result.similarity >= 0.45) return "Possible match — review required";
  return "Not comparable";
}

function isProductTitle(value) {
  const title = String(value || "").trim();
  if (title.length < 4) return false;
  if (/^(?:www\.)?jumia(?:\.co\.ke)?$/i.test(title)) return false;
  return !/(access denied|verify you are human|captcha|no results found|there are no results|just a moment)/i.test(title);
}

function isSkuLike(value) {
  const term = String(value || "").trim();
  return term.length >= 8 && /\d/.test(term) && /^[a-z0-9-]+$/i.test(term);
}

function searchVariants(value) {
  const original = String(value || "").trim();
  if (!original || isSkuLike(original)) return original ? [original] : [];
  const words = tokens(original);
  const variants = [original];
  const add = candidate => {
    if (candidate && !variants.some(variant => variant.toLowerCase() === candidate.toLowerCase())) variants.push(candidate);
  };
  for (let size = Math.min(words.length - 1, 6); size >= 3; size--) add(words.slice(0, size).join(" "));
  if (words.length >= 4) add(words.slice(1).join(" "));
  return variants;
}

function classifyQueryMatch(query, candidate) {
  if (isSkuLike(query)) {
    return String(candidate?.url || "").toLowerCase().includes(String(query).toLowerCase())
      ? "Exact match"
      : "Possible match — review required";
  }
  const result = score(query, candidate?.title);
  const queryHasSpecs = tokens(query).some(hasDigit);
  if (result.similarity >= 0.8 && result.brandMatch && (!queryHasSpecs || result.specsMatch)) return "High-confidence equivalent";
  if (result.similarity >= 0.4) return "Possible match — review required";
  return "Not comparable";
}

function selectClosest(query, candidates) {
  const usable = (candidates || []).filter(candidate => isProductTitle(candidate.title));
  if (!usable.length) return null;
  if (isSkuLike(query)) {
    const exactUrlMatch = usable.find(candidate => String(candidate.url || "").toLowerCase().includes(String(query).toLowerCase()));
    return exactUrlMatch || usable[0];
  }
  const ranked = usable.map(candidate => ({ candidate, rank: matchRank(query, candidate.title) }))
    .sort((left, right) => right.rank - left.rank);
  return ranked[0].rank >= 0.25 ? ranked[0].candidate : null;
}

function selectLowestPriceMatch(productTitle, candidates) {
  const ranked = (candidates || []).filter(candidate => isProductTitle(candidate.title))
    .map(candidate => ({ candidate, confidence: classify(productTitle, candidate), rank: matchRank(productTitle, candidate.title) }));
  const verified = ranked.filter(result => result.confidence === "High-confidence equivalent" && Number(result.candidate.price) > 0);
  if (verified.length) {
    verified.sort((left, right) => Number(left.candidate.price) - Number(right.candidate.price) || right.rank - left.rank);
    return verified[0].candidate;
  }
  ranked.sort((left, right) => right.rank - left.rank);
  return ranked[0]?.candidate || null;
}

module.exports = { classify, classifyQueryMatch, isProductTitle, score, searchVariants, selectClosest, selectLowestPriceMatch, tokens };