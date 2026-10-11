import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTooLargeToScore } from './placeScope';

describe('isTooLargeToScore', () => {
  it('flags neighbourhoods, towns, regions and countries', () => {
    assert.equal(isTooLargeToScore(['sublocality_level_1', 'sublocality', 'political']), true); // Pettah
    assert.equal(isTooLargeToScore(['neighborhood', 'political']), true);
    assert.equal(isTooLargeToScore(['locality', 'political']), true); // Gampaha, Mumbai
    assert.equal(isTooLargeToScore(['administrative_area_level_1', 'political']), true); // Western Province
    assert.equal(isTooLargeToScore(['country', 'political']), true); // Sri Lanka
  });

  it('allows specific places to be scored', () => {
    assert.equal(isTooLargeToScore(['bus_station', 'transit_station', 'point_of_interest']), false);
    assert.equal(isTooLargeToScore(['shopping_mall', 'point_of_interest', 'establishment']), false);
    assert.equal(isTooLargeToScore(['route']), false);
    assert.equal(isTooLargeToScore(['street_address']), false);
  });

  it('allows places with unknown types', () => {
    assert.equal(isTooLargeToScore(undefined), false);
    assert.equal(isTooLargeToScore([]), false);
  });
});
