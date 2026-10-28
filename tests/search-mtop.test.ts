import { describe, expect, it } from 'vitest';
import {
  SEARCH_APP_ID,
  SEARCH_MTOP_API,
  mapOffer,
  parseOfferItemsFromMtopText,
  readSearchMtopRequestMeta,
} from '../src/session/search-mtop.js';

function mtopUrl(data: unknown): string {
  return `https://h5api.m.1688.com/h5/${SEARCH_MTOP_API}/1.0/?data=${encodeURIComponent(JSON.stringify(data))}`;
}

describe('readSearchMtopRequestMeta', () => {
  it('extracts appId, method, beginPage, and sortType from request URLs', () => {
    const url = mtopUrl({
      appId: SEARCH_APP_ID,
      params: JSON.stringify({
        method: 'getOfferList',
        beginPage: '2',
        sortType: 'va_price_asc',
      }),
    });

    expect(readSearchMtopRequestMeta(url)).toEqual({
      appId: SEARCH_APP_ID,
      method: 'getOfferList',
      beginPage: 2,
      sortType: 'va_price_asc',
    });
  });

  it('leaves beginPage undefined when it is absent', () => {
    const url = mtopUrl({
      appId: SEARCH_APP_ID,
      params: JSON.stringify({ method: 'getOfferList' }),
    });

    expect(readSearchMtopRequestMeta(url)).toEqual({
      appId: SEARCH_APP_ID,
      method: 'getOfferList',
      beginPage: undefined,
      sortType: undefined,
    });
  });

  it('returns null for unrelated URLs', () => {
    expect(readSearchMtopRequestMeta('https://example.com/')).toBeNull();
  });
});

describe('parseOfferItemsFromMtopText', () => {
  it('parses offer items from JSONP response bodies', () => {
    const offers = parseOfferItemsFromMtopText(
      'mtopjsonp1({"data":{"data":{"OFFER":{"items":[{"data":{"offerId":"123","title":"<font>Hat</font>","priceInfo":{"price":"3.50"},"offerPicUrl":"https://img","province":"浙江","city":"义乌","bookedCount":"100+","isP4P":"true","factoryInspection":"true","businessInspection":"false","superFactory":"true","tags":[{"text":"  退货包运费 "}],"winPortUrl":"https://shop-old","shop":{"text":"工厂店","tpYear":"5"},"shopAddition":{"shopLinkUrl":"https://shop"}}}]}}}})',
    );

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      offerId: '123',
      title: 'Hat',
      price: { text: '¥3.50', min: 3.5, max: 3.5 },
      supplier: { name: '工厂店', shopUrl: 'https://shop', years: 5 },
      location: { province: '浙江', city: '义乌' },
      verified: { factory: true, business: false, superFactory: true },
      tags: ['退货包运费'],
      isP4P: true,
      turnover: '100+',
      url: 'https://detail.1688.com/offer/123.html',
      image: 'https://img',
    });
  });
});

describe('mapOffer', () => {
  it('preserves inspection field provenance without claiming a membership credential', () => {
    const offer = mapOffer({ data: { offerId: '1', factoryInspection: 'true', businessInspection: 'true', bookedCount: '100+' } });
    expect(offer?.verificationSource).toEqual({ endpoint: SEARCH_MTOP_API, factory: 'factoryInspection', business: 'businessInspection', superFactory: 'superFactory' });
    expect(offer?.demand).toMatchObject({ orderCountText: '100+', orderCountSource: 'bookedCount', orderCountPeriod: null });
  });

  it.each([
    [{ orderCountText: '100单', orderCount: 100, bookedCount: '200' }, 'orderCountText'],
    [{ orderCount: 100, bookedCount: '200' }, 'bookedCount'],
    [{ orderCount: 100 }, 'orderCount'],
    [{ orderCount: '100单', bookedCount: '200' }, 'orderCount'],
    [{}, null],
  ])('reports the actual demand display source and does not invent a period', (fields, source) => {
    expect(mapOffer({ data: { offerId: '1', ...fields } })?.demand).toMatchObject({ orderCountSource: source, orderCountPeriod: null });
  });

  it('returns null when offerId is missing', () => {
    expect(mapOffer({ data: { title: 'missing id' } })).toBeNull();
  });
});
