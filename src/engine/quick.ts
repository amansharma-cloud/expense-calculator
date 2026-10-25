import { addDays } from './dates'
import { parseAmount } from './money'
import type { ISODate, Paise, Transaction } from './types'

/**
 * Local, deterministic helpers for fast entry: category suggestion and natural-language parsing.
 * No network, no AI service.
 */

/** concept -> keywords found in a description. */
const CONCEPTS: Record<string, string[]> = {
  food: ['grocery', 'groceries', 'vegetable', 'veggies', 'fruit', 'milk', 'bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'kirana', 'supermarket'],
  eating: ['lunch', 'dinner', 'breakfast', 'zomato', 'swiggy', 'restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'dominos', 'mcdonald', 'starbucks', 'chai', 'snack', 'biryani'],
  cab: ['uber', 'ola', 'rapido', 'cab', 'auto', 'metro', 'bus', 'train', 'flight'],
  fuel: ['petrol', 'diesel', 'fuel', 'toll', 'fastag', 'parking', 'car service', 'bike service'],
  utilities: ['electricity', 'ebill', 'e bill', 'water bill', 'gas', 'cylinder', 'lpg', 'maintenance'],
  subscription: ['netflix', 'prime', 'hotstar', 'spotify', 'youtube', 'subscription', 'icloud', 'google one'],
  recharge: ['recharge', 'airtel', 'jio', 'vi ', 'wifi', 'broadband', 'internet', 'dth'],
  health: ['medicine', 'pharmacy', 'doctor', 'hospital', 'clinic', 'apollo', 'medplus', 'lab', 'dental'],
  shopping: ['amazon', 'flipkart', 'myntra', 'shopping', 'clothes', 'shoes', 'mall', 'ajio', 'meesho'],
  personal: ['haircut', 'salon', 'spa', 'gym', 'barber'],
  gift: ['gift', 'prasad', 'sweets', 'flowers', 'temple', 'donation'],
}

/** Words that, if found in a profile category name, make it the home of a concept. */
const CATEGORY_HINTS: Record<string, string[]> = {
  food: ['food', 'grocer'],
  eating: ['dining', 'eating', 'lunch', 'zomato', 'restaurant'],
  cab: ['cab', 'travel', 'transport'],
  fuel: ['petrol', 'fuel', 'car', 'bike', 'transport'],
  utilities: ['util', 'bill', 'electric'],
  subscription: ['subscription', 'misc'],
  recharge: ['recharge', 'wifi', 'internet', 'phone'],
  health: ['health', 'medic', 'doctor'],
  shopping: ['shopping'],
  personal: ['personal', 'haircut', 'care'],
  gift: ['prasad', 'gift', 'sweet'],
}

const DEFAULT_NAME: Record<string, string> = {
  food: 'Food & Grocery',
  eating: 'Eating out',
  cab: 'Transport & Fuel',
  fuel: 'Transport & Fuel',
  utilities: 'Bills & Utilities',
  subscription: 'Subscriptions',
  recharge: 'Recharge & Internet',
  health: 'Health',
  shopping: 'Shopping',
  personal: 'Personal care',
  gift: 'Gifts & Offerings',
}

export const DEFAULT_CATEGORIES = [...Object.values(DEFAULT_NAME), 'Family', 'Cash', 'Other']

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Suggest a category: learned merchants first, then built-in keywords mapped onto the profile's own categories. */
export function suggestCategory(description: string, categories: string[], history: Transaction[] = []): string | null {
  const d = norm(description)
  if (!d) return null

  const counts = new Map<string, Map<string, number>>()
  for (const t of history) {
    const m = norm(t.merchant)
    if (!m || t.type !== 'expense') continue
    const inner = counts.get(m) ?? new Map<string, number>()
    inner.set(t.category, (inner.get(t.category) ?? 0) + 1)
    counts.set(m, inner)
  }
  for (const [m, inner] of counts) {
    if (d === m || d.includes(m)) {
      return [...inner.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  const words = ` ${d} `
  for (const [concept, kws] of Object.entries(CONCEPTS)) {
    if (!kws.some((k) => words.includes(` ${k.trim()}`))) continue
    const hints = CATEGORY_HINTS[concept] ?? []
    const matches = categories.filter((c) => hints.some((h) => norm(c).includes(h)))
    // The user's own category names (e.g. imported from their sheet) win over the built-in defaults.
    const own = matches.find((c) => !DEFAULT_CATEGORIES.includes(c)) ?? matches[0]
    if (own) return own
    return categories.includes(DEFAULT_NAME[concept]) ? DEFAULT_NAME[concept] : null
  }
  return null
}

export interface QuickParse {
  amountPaise: Paise | null
  date: ISODate
  description: string
  missing: ('amount' | 'description')[]
}

const FILLER = /\b(spent|paid|pay|payment|bought|buy|purchase[d]?|for|on|at|to|of|rs|inr|rupees?)\b/gi

/** "Spent ₹350 on groceries today" -> {amount: 35000, date: today, description: 'groceries'} */
export function parseQuickEntry(text: string, today: ISODate): QuickParse {
  let rest = ` ${text.trim()} `
  let date = today

  const rel = rest.match(/\b(day before yesterday|yesterday|today|(\d{1,2}) days? ago)\b/i)
  if (rel) {
    const w = rel[1].toLowerCase()
    date = w === 'today' ? today : w === 'yesterday' ? addDays(today, -1) : w.startsWith('day before') ? addDays(today, -2) : addDays(today, -Number(rel[2]))
    rest = rest.replace(rel[0], ' ')
  }
  const iso = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) {
    date = iso[1]
    rest = rest.replace(iso[0], ' ')
  }

  // Prefer a number with a currency marker; otherwise the last standalone number.
  let amountPaise: Paise | null = null
  const marked = rest.match(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|\brs\b|\binr\b|\brupees?\b)/i)
  if (marked) {
    amountPaise = parseAmount(marked[1] ?? marked[2])
    rest = rest.replace(marked[0], ' ')
  } else {
    const nums = [...rest.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d{1,2})?)(?![\w.])/g)]
    const last = nums[nums.length - 1]
    if (last) {
      amountPaise = parseAmount(last[1])
      rest = rest.slice(0, last.index) + ' ' + rest.slice((last.index ?? 0) + last[0].length)
    }
  }

  const description = rest.replace(FILLER, ' ').replace(/[–—\-:,]+/g, ' ').replace(/\s+/g, ' ').trim()
  const missing: QuickParse['missing'] = []
  if (!amountPaise || amountPaise <= 0) missing.push('amount')
  if (!description) missing.push('description')
  return { amountPaise: amountPaise && amountPaise > 0 ? amountPaise : null, date, description, missing }
}
