# Alytic

An Arabic-first EGX investing desk: users track portfolios and get AI recommendations; the platform owner runs billing and users from an admin panel.

## People and roles

**User**:
Anyone with an Alytic account.
_Avoid_: Customer, client, account (when meaning the person)

**Admin**:
A User who runs the admin panel and can change other Users' roles, Subscriptions and Credits.
_Avoid_: Owner, superuser, مشرف in code (label only)

**Marketer**:
A User who can see the admin users screen but change nothing on it.
_Avoid_: Viewer, read-only admin

## Billing

**Activation**:
An Admin manually turning on or extending a User's Subscription after confirming their InstaPay transfer. The only way a Subscription starts.
_Avoid_: Checkout, purchase, payment

**Renewal status**:
Where a User stands for billing: exactly one of Active subscriber, Expired, Trial, or Never subscribed.
_Avoid_: Plan, tier

**Expired**:
A User whose paid Subscription ran out and wasn't renewed; the warmest renewal candidate. Labelled "اشتراك منتهي".
_Avoid_: Lapsed, churned, inactive

**Never subscribed**:
A User who has never paid and whose Trial is over. Labelled "لم يشترك".
_Avoid_: Lapsed, free user

**Trial ending**:
A User on Trial with two days or fewer left, the same cut-off the admin users screen uses to flag a trial as about to end. It overlaps Trial: such a User is in both. Used to target announcements.
_Avoid_: Expiring, last chance

**Credits**:
Extra AI-usage balance an Admin adds to a User (usually a paid pack), spent only after the User's normal allowance runs out.
_Avoid_: Tokens, points

## Investing

**Investing style**:
Whether a Portfolio is run as a trader, medium-term, or long-term; either chosen by the User or inferred from their trades.
_Avoid_: Risk profile, persona

**Portfolio**:
One of a User's separate books of Positions, with its own cash, Investing style, trades and profit/loss. Every User has one; a الحريفة subscriber can hold up to three. Labelled "محفظة".
_Avoid_: Wallet, account, sub-portfolio

**Position**:
A stock a User currently holds in one of their Portfolios, with its share count and average cost.
_Avoid_: Holding, stock (when meaning the User's stake)

**Corporate action**:
A bonus-share issue, split, reverse split or merger share swap that changes how many shares a Position holds without money moving. The app finds it by comparing the prices it saved at each daily close with the feed's adjusted history, confirms the ratio with a web search, and rewrites the Position's share count and average cost (purchase value unchanged), with an undo on the card.
_Avoid_: Split (when meaning any of them), dividend (a cash dividend is a trade, not this)

**Order added**:
The order a User's Positions arrived in: Positions from a broker screenshot keep the screenshot's row order, and Positions added by hand afterwards go to the end. Labelled "ترتيب الإضافة".
_Avoid_: Screenshot order, manual order, insertion order

**Recommendation**:
A buy, hold, sell or reduce call on one stock that the app handed a User, with its reference price, target, stop and horizon. Logged when it's issued and never edited afterwards. It ends as hit target, hit stop or expired. The model's wider vocabulary (accumulate, take profit, exit…) folds into these four, and "wait"/"avoid" aren't Recommendations.
_Avoid_: Signal, tip, verdict (a verdict is the model's raw output, before it's logged)

**Investor flows**:
One closed session's net buying or selling per investor group (Egyptians, Arabs, foreigners, individuals, institutions), taken from the market-wrap news after the close and shown only if it passed the app's checks and belongs to the current session. Labelled "تعاملات المستثمرين".
_Avoid_: Order flow, fund flows

**Track record**:
How Recommendations performed once resolved: hit rate, returns, and returns against EGX30. Labelled "سجل الأداء".
_Avoid_: Backtest (it only covers calls that were actually issued, never simulated ones)
