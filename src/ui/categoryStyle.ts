/**
 * Maps a category / bill / set-aside name to an icon and a colour, so the same thing looks the same everywhere.
 * Pure keyword matching on the name; unknown names fall back to a neutral "other".
 */
export type CatIcon =
  | 'food' | 'car' | 'home' | 'bolt' | 'phone' | 'bag' | 'heart' | 'trend' | 'card' | 'users' | 'cash' | 'play' | 'scissors' | 'gift' | 'dots'

export interface CategoryStyle {
  concept: string
  icon: CatIcon
  /** CSS colour (a chart-palette variable, so it follows light/dark) */
  color: string
}

const RULES: { concept: string; icon: CatIcon; color: string; re: RegExp }[] = [
  { concept: 'home', icon: 'home', color: 'var(--s7)', re: /\brent\b|housing|\bhome\b|maintenance|society/ },
  { concept: 'utilities', icon: 'bolt', color: 'var(--s4)', re: /electric|\bebill\b|e bill|hydro|water|\bgas\b|cylinder|lpg|utilit/ },
  { concept: 'phone', icon: 'phone', color: 'var(--s3)', re: /recharge|mobile|phone|wifi|internet|broadband|airtel|jio|rogers|bell\b|telus|dth/ },
  { concept: 'invest', icon: 'trend', color: 'var(--s6)', re: /sip|mutual|\bfund\b|invest|saving|\brd\b|\blic\b|gold|stock|ppf|nps|jupiter|emergency/ },
  { concept: 'emi', icon: 'card', color: 'var(--s7)', re: /\bemi\b|loan|credit card|card\b|onecard/ },
  { concept: 'food', icon: 'food', color: 'var(--s2)', re: /food|grocer|vegetable|fruit|milk|dining|lunch|dinner|breakfast|zomato|swiggy|cafe|restaurant|snack|eating|tim hortons|costco|loblaws/ },
  { concept: 'transport', icon: 'car', color: 'var(--s1)', re: /transport|petrol|diesel|fuel|cab|uber|ola\b|rapido|metro|bus\b|train|travel|toll|parking|car\b|bike|ttc|presto/ },
  { concept: 'shopping', icon: 'bag', color: 'var(--s5)', re: /shopping|amazon|flipkart|myntra|clothes|mall|store/ },
  { concept: 'health', icon: 'heart', color: 'var(--s8)', re: /health|medic|doctor|pharmacy|hospital|clinic|dental|gym|fitness/ },
  { concept: 'family', icon: 'users', color: 'var(--s5)', re: /\bmom\b|\bpapa\b|family|parents|mummy|ghar|aaru|mishu|ashu|kids|wife|husband/ },
  { concept: 'gift', icon: 'gift', color: 'var(--s5)', re: /gift|prasad|sweets|flowers|temple|donation|birthday|festival|diwali/ },
  { concept: 'subscription', icon: 'play', color: 'var(--s3)', re: /subscri|netflix|prime|spotify|hotstar|youtube|icloud/ },
  { concept: 'personal', icon: 'scissors', color: 'var(--s8)', re: /personal|haircut|hair cut|salon|spa\b|barber/ },
  { concept: 'cash', icon: 'cash', color: 'var(--s4)', re: /\bcash\b|atm|withdraw/ },
]

export function categoryStyle(name: string): CategoryStyle {
  const n = ` ${name.toLowerCase()} `
  for (const r of RULES) if (r.re.test(n)) return { concept: r.concept, icon: r.icon, color: r.color }
  return { concept: 'other', icon: 'dots', color: 'var(--muted)' }
}
