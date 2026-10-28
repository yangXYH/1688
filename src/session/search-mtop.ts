import { parseMtopJsonp } from './mtop.js';

export const SEARCH_MTOP_API = 'mtop.relationrecommend.wirelessrecommend.recommend';
export const SEARCH_APP_ID = '32517';

export interface Offer {
  offerId: string;
  title: string;
  price: { text: string; min: number | null; max: number | null };
  supplier: {
    name: string | null;
    shopUrl: string | null;
    years: number | null;
  };
  location: { province: string | null; city: string | null };
  bizType: string | null;
  verified: { factory: boolean; business: boolean; superFactory: boolean };
  /** Payload flags, not independently validated membership credentials. */
  verificationSource?: { endpoint: string; factory: string; business: string; superFactory: string };
  tags: string[];
  serviceTags?: string[];
  productBadges?: string[];
  demand?: {
    orderCountText: string | null;
    orderCount: number | null;
    orderCountSource?: string | null;
    orderCountPeriod?: string | null;
    repurchaseRateText: string | null;
    repurchaseRate: number | null;
  };
  isP4P: boolean;
  turnover: string | null;
  url: string;
  image: string | null;
}

export interface RawOfferItem {
  cellType?: string;
  data?: {
    offerId?: string;
    title?: string;
    priceInfo?: { price?: string };
    offerPicUrl?: string;
    loginId?: string;
    memberId?: string;
    province?: string;
    city?: string;
    bookedCount?: string;
    repurchaseRate?: string;
    repurchaseRateText?: string;
    orderCount?: string | number;
    orderCountText?: string;
    serviceTags?: { text?: string }[];
    productBadges?: { text?: string }[];
    isP4P?: string;
    bizType?: string;
    factoryInspection?: string;
    businessInspection?: string;
    superFactory?: string;
    tags?: { text?: string }[];
    winPortUrl?: string;
    shop?: { text?: string; tpYear?: string };
    shopAddition?: { shopLinkUrl?: string };
  };
}

export interface SearchMtopRequestMeta {
  appId?: string;
  method?: string;
  beginPage?: number;
  sortType?: string;
}

function bool(s?: string): boolean {
  return s === 'true';
}

function parseCountText(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (!text) return null;
  const compact = text.replace(/,/g, '').replace(/\s+/g, '');
  const match = compact.match(/(\d+(?:\.\d+)?)(万|w|W|亿|k|K)?/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? '';
  const multiplier =
    unit === '亿'
      ? 100000000
      : unit === '万' || unit === 'w' || unit === 'W'
      ? 10000
      : unit === 'k' || unit === 'K'
      ? 1000
      : 1;
  return Math.round(value * multiplier);
}

function parsePercentText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function textList(items: { text?: string }[] | undefined): string[] {
  return (items ?? [])
    .map((t) => t?.text?.trim() ?? '')
    .filter((s): s is string => !!s);
}

export function mapOffer(item: RawOfferItem): Offer | null {
  const d = item.data;
  if (!d?.offerId) return null;
  const title = (d.title ?? '').replace(/<\/?font[^>]*>/g, '').trim();
  const priceRaw = d.priceInfo?.price;
  const price = priceRaw ? parseFloat(priceRaw) : null;
  const yearsRaw = d.shop?.tpYear;
  const years = yearsRaw ? parseInt(yearsRaw, 10) : null;
  const tags = (d.tags ?? [])
    .map((t) => t?.text?.trim() ?? '')
    .filter((s): s is string => !!s);
  const serviceTags = textList(d.serviceTags);
  const productBadges = textList(d.productBadges);
  const orderCountText =
    d.orderCountText ??
    (typeof d.orderCount === 'string' ? d.orderCount : undefined) ??
    d.bookedCount ??
    null;
  const repurchaseRateText =
    d.repurchaseRateText ?? d.repurchaseRate ?? null;
  return {
    offerId: d.offerId,
    title,
    price: {
      text: priceRaw ? `¥${priceRaw}` : '',
      min: price,
      max: price,
    },
    supplier: {
      name: d.shop?.text ?? null,
      shopUrl: d.shopAddition?.shopLinkUrl ?? d.winPortUrl ?? null,
      years,
    },
    location: {
      province: d.province ?? null,
      city: d.city ?? null,
    },
    bizType: d.bizType ?? null,
    verified: {
      factory: bool(d.factoryInspection),
      business: bool(d.businessInspection),
      superFactory: bool(d.superFactory),
    },
    verificationSource: {
      endpoint: SEARCH_MTOP_API,
      factory: 'factoryInspection',
      business: 'businessInspection',
      superFactory: 'superFactory',
    },
    tags,
    ...(serviceTags.length ? { serviceTags } : {}),
    ...(productBadges.length ? { productBadges } : {}),
    demand: {
      orderCountText,
      orderCount:
        typeof d.orderCount === 'number'
          ? d.orderCount
          : parseCountText(orderCountText),
      orderCountSource: d.orderCountText != null ? 'orderCountText'
        : typeof d.orderCount === 'string' ? 'orderCount'
        : d.bookedCount != null ? 'bookedCount' : d.orderCount != null ? 'orderCount' : null,
      orderCountPeriod: null,
      repurchaseRateText,
      repurchaseRate: parsePercentText(repurchaseRateText),
    },
    isP4P: bool(d.isP4P),
    turnover: d.bookedCount ?? null,
    url: `https://detail.1688.com/offer/${d.offerId}.html`,
    image: d.offerPicUrl ?? null,
  };
}

export function readSearchMtopRequestMeta(url: string): SearchMtopRequestMeta | null {
  if (!url.includes(SEARCH_MTOP_API)) return null;
  try {
    const dataParam = new URLSearchParams(new URL(url).search).get('data') ?? '';
    if (!dataParam) return null;
    const dataObj = JSON.parse(dataParam) as {
      appId?: unknown;
      params?: string;
    };
    const params = JSON.parse(dataObj.params ?? '{}') as {
      method?: string;
      beginPage?: number | string;
      sortType?: string;
    };
    const beginPage = params.beginPage === undefined ? undefined : Number(params.beginPage);
    return {
      appId: String(dataObj.appId),
      method: params.method,
      beginPage,
      sortType: params.sortType,
    };
  } catch {
    return null;
  }
}

export function parseOfferItemsFromMtopText(text: string): Offer[] {
  const json = parseMtopJsonp<{
    data?: { data?: { OFFER?: { items?: RawOfferItem[] } } };
  }>(text);
  const items = json?.data?.data?.OFFER?.items ?? [];
  return items.map(mapOffer).filter((o): o is Offer => o !== null);
}
