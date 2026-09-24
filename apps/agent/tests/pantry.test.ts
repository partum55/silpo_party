import assert from "node:assert/strict";
import test from "node:test";

import { isPantryStaple } from "../src/domain/pantry.ts";

test("recognises pantry staples in common Ukrainian and English forms", () => {
  for (const name of [
    "сіль", "Сіль кухонна", "морська сіль", "перець", "чорний перець", "перець чорний мелений",
    "вода", "питна вода", "олія", "олія соняшникова", "оливкова олія", "оцет", "цукор", "сода",
    "лавровий лист", "спеції", "salt", "black pepper", "water", "olive oil", "sugar",
  ]) {
    assert.equal(isPantryStaple(name), true, name);
  }
});

test("keeps real ingredients and drinks that share a word with a staple", () => {
  for (const name of ["перець болгарський", "солодкий перець", "вода мінеральна", "сир", "цибуля", "бекон", "bell pepper", "мука", "олівки"]) {
    assert.equal(isPantryStaple(name), false, name);
  }
});
