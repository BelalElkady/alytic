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

**Credits**:
Extra AI-usage balance an Admin adds to a User (usually a paid pack), spent only after the User's normal allowance runs out.
_Avoid_: Tokens, points

## Investing

**Investing style**:
Whether a User invests as a trader, medium-term, or long-term; either chosen by the User or inferred from their trades.
_Avoid_: Risk profile, persona
