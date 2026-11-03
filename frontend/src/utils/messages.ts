/** Friendly copy for the welcome card. Everything here is picked from the date / check-in time, nothing is random per reload. */

const DAILY: string[] = [
  "Small steps every day lead to big results.",
  "Today is a fresh page. Write something good on it.",
  "Do one thing at a time, and do it well.",
  "Good work starts with a calm mind.",
  "Progress, not perfection.",
  "Kind words and steady effort make a great team.",
  "Focus on what you can finish today.",
  "A little courage today makes tomorrow easier.",
  "Great things are built one task at a time.",
  "Be curious. Ask one good question today.",
  "Your effort matters more than you think.",
  "Start where you are. Use what you have.",
  "Help someone on your team today.",
  "Consistency beats intensity.",
  "Take a short break, then do your best work.",
  "Learn one new thing today.",
  "Done is better than perfect.",
  "Smile first. The day follows.",
  "Make today a little better than yesterday.",
  "Clear goals make busy days simple.",
  "Listen well, speak clearly, work together.",
  "Every expert was once a beginner.",
  "Quality is a habit, not an accident.",
  "Be proud of the work you do today.",
  "Say thank you to someone today.",
  "Plan the day, then enjoy the work.",
  "Mistakes teach. Keep going.",
  "Energy goes where focus goes.",
  "Teamwork turns small efforts into big wins.",
  "Finish strong, one task at a time.",
  "Believe in the work and in each other.",
]

/** "Word of the day" - changes at midnight, same for everyone that day. */
export function dailyMessage(d = new Date()): string {
  const dayOfYear = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)
  return DAILY[dayOfYear % DAILY.length]
}

/** Start-up window wording: a time-of-day hello plus a line of "special words" (weekday special, else the daily thought). */
export function startupWords(d = new Date()): { hello: string; words: string } {
  const h = d.getHours()
  const hello = h < 8 ? 'Rise and shine' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const dow = d.getDay()
  const special: Record<number, string> = {
    1: 'Happy Monday! A fresh week, a fresh start.',
    3: 'Halfway through the week. Keep going!',
    5: "It's Friday! Finish the week strong.",
    6: 'Happy Saturday! Thanks for showing up.',
  }
  return { hello, words: special[dow] ?? dailyMessage(d) }
}

export type Punctuality = 'early' | 'on_time' | 'late'

const EARLY = [
  "Early bird! Thank you for starting the day so early. We really appreciate your dedication.",
  "You're here ahead of time. Wonderful way to begin the day!",
  "What a great start! Your early arrival sets a lovely tone for the team.",
]
const ON_TIME = [
  "Right on time. Have a great day at work!",
  "Perfect timing. Wishing you a smooth and productive day.",
]
const LATE = [
  "Welcome in! We're glad you made it. Take a breath, grab some water and ease into the day.",
  "Good to see you. Some days start slower than planned. Let's make the rest of the day a good one.",
  "Thanks for checking in. Tomorrow is a fresh start. We'll make today count together.",
]

/** Picks a stable message for the employee + date so it doesn't flip on every refresh. */
export function checkInMessage(kind: Punctuality, seed: string): string {
  const list = kind === 'early' ? EARLY : kind === 'late' ? LATE : ON_TIME
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return list[h % list.length]
}
