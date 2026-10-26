/**
 * The guided tour: one entry per step. `target` is a CSS selector (always a `data-tour` attribute, so restyling
 * never breaks it); a step without a target, or whose target is not on screen, is shown centred.
 * `route` is the page the step lives on; the tour navigates there first.
 */
export interface TourStep {
  id: string
  route: 'dashboard' | 'transactions' | 'budget' | 'reports' | 'settings'
  target?: string
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', route: 'dashboard', title: 'Welcome to Daily Spend', body: 'It tells you how much you can safely spend today, after your bills, savings and investments are set aside. This short tour shows you around. It takes about a minute.' },
  { id: 'hero', route: 'dashboard', target: '[data-tour="hero"]', title: 'Your limit for today', body: 'This is the number to remember. Spend less than it and you stay on track; whatever you do not spend rolls into tomorrow.' },
  { id: 'quick', route: 'dashboard', target: '[data-tour="quick"]', title: 'Quick actions', body: 'Add an expense, tick off bills you have paid, import your old Excel tracker or take a backup, all one tap away.' },
  { id: 'balance', route: 'dashboard', target: '[data-tour="balance"]', title: 'Money in your account', body: 'What should be in your bank right now, and what will be left after everything planned. Compare it with your real balance to catch missing entries.' },
  { id: 'bills', route: 'dashboard', target: '[data-tour="bills"]', title: 'Upcoming bills', body: 'Rent, EMIs, subscriptions and other bills that are due, soonest first. Tap Paid when the money has left your account.' },
  { id: 'fab', route: 'dashboard', target: '[data-tour="fab"]', title: 'Add an expense', body: 'Use this button on any page to record what you spent. It takes a few seconds, and your limit updates straight away.' },
  { id: 'nav', route: 'dashboard', target: '[data-tour="nav"]', title: 'Move around', body: 'Dashboard for today, History for every entry, Budget for your plan, Reports for charts and Settings for backups, PIN and sync.' },
  { id: 'history', route: 'transactions', target: '[data-tour="history"]', title: 'History', body: 'Search and filter everything you have recorded, open an entry to edit it, or export it to Excel or CSV.' },
  { id: 'budget', route: 'budget', target: '[data-tour="budget"]', title: 'Your plan', body: 'Set aside rent, EMIs, SIPs and savings first. Further down you can add expected bills that vary, and subscriptions, monthly or yearly.' },
  { id: 'reports', route: 'reports', target: '[data-tour="reports"]', title: 'Reports', body: 'See where the money went, how this cycle compares with earlier ones, and download your data any time.' },
  { id: 'settings', route: 'settings', target: '[data-tour="data-health"]', title: 'Keep your data safe', body: 'Everything stays on this device. Download a backup here, add a PIN to encrypt it, or turn on cloud sync to use the app on another device.' },
  { id: 'done', route: 'dashboard', title: 'You are all set', body: 'Add your first expense with the + button. You can replay this tour whenever you like with the ? button in the corner.' },
]
