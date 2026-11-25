# Kitchen Plus: making money from Family Kitchen

The meal plan stays **free for everyone**. That keeps people sharing the app on WhatsApp, and sharing is how you get new users.
**Kitchen Plus** is a subscription that adds tools families use every day:

| Plus feature | Why people pay |
|---|---|
| ⏱ One-tap timers: tap any "10 min" in a step | Useful at the stove every night |
| 👩‍🍳 Cook mode: one big step at a time, screen stays on | Hands-free cooking |
| 🛒 Grocery list: tick items off, share on WhatsApp | Used every week, so people keep paying |
| ❤️ Favourites and 📝 notes | Their own data, so they don't want to leave |
| 🎨 Five extra colour themes | Fun and personal |
| 🖨 Print the week | For the fridge |

Free users still see the Plus buttons, marked with 👑. Tapping one opens the upgrade screen with that feature at the top.
Everyone gets a **7-day free trial** once.

## Suggested prices

These are already in `index.html`, and you can change them:

- **Yearly $19.99**, shown first as "Save 44%". Steady, predictable income.
- **Monthly $2.99**. Easy to say yes to.
- **Lifetime $39**. Some people hate subscriptions; this catches them.

Rough guide: 300 yearly subscribers ≈ $6,000 a year, before fees of about 5% + 50¢ per sale.

## Setup (about 30 minutes)

The app has no server, so it uses **Lemon Squeezy** for payments. It handles cards, Apple Pay and PayPal, and works in most countries.
It also handles worldwide sales tax/VAT for you, and it sends each buyer a **licence key** that the app checks.

1. Sign up at lemonsqueezy.com and create a store. Connect your bank or PayPal for payouts.
2. Create a product called **Kitchen Plus** with three variants:
   - Monthly: subscription, $2.99 every month
   - Yearly: subscription, $19.99 every year
   - Lifetime: single payment, $39
3. On the product, turn on **"Generate license keys"**.
   - Set the **activation limit** to about **5**, so a family can use it on several phones.
   - For subscriptions, keys stop working when someone cancels. The app checks this every few days.
4. For each variant, copy its **checkout link** ("Share" → checkout URL).
5. Find your **Store ID** under Settings → Stores. It's the number.
6. Open `index.html` and fill in the `KITCHEN PLUS` settings near the top of the script:

   ```js
   var PLUS = {
     STORE_ID: '12345',
     TRIAL_DAYS: 7,
     PLANS: [
       { id: 'yearly',   ..., link: 'https://yourstore.lemonsqueezy.com/buy/...' },
       { id: 'monthly',  ..., link: 'https://yourstore.lemonsqueezy.com/buy/...' },
       { id: 'lifetime', ..., link: 'https://yourstore.lemonsqueezy.com/buy/...' }
     ]
   };
   ```
   A plan with an empty `link` is hidden. While no links are set, buyers see "Payments are not set up yet".
7. Commit and push. That's it.

**How buyers unlock:** they pay, get an email with their key, then tap **✨ Get Plus → I already have a licence key**, paste it and tap **Unlock**.
You can also send people a link like `https://<your-site>/?license=THEIR-KEY`. It opens the app with the key already filled in.

## Testing it yourself

- Add `?plus=preview` to the app's address to see everything unlocked. Nothing is saved, so close the tab to go back.
- Add `?date=2027-01-18` to pretend it's a different day.
- In Lemon Squeezy, use **test mode** to buy with a test card and get a real test key.

## Ideas to grow income

- Post a short screen recording of the timers and cook mode in your WhatsApp channel. Showing works better than telling.
- Run an offer before Ramadan, e.g. "Yearly 30% off" using a Lemon Squeezy discount code.
- Later, sell **new 8-week plans** (e.g. "Summer plan", "Kids' lunchbox plan") as a Plus extra.

## Honest limits

- Licence checks run on the phone. Someone technical could get around them. That's normal for web apps at this size, and it isn't worth worrying about.
- Your data and your users' data stay on their phones. Nothing is sent anywhere, except the licence key when checking it with Lemon Squeezy.
