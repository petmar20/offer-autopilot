# Offer Autopilot

A Windows tray app that signs in to Citi on a schedule and enrolls every Merchant Offer on each of your cards. It saves the details of each offer it enrolls, and lists your priority stores (Walmart, Home Depot, gas stations, and so on) first.

## How it works

- Drives a real Chrome window with Playwright, or Edge when Chrome isn't installed. The browser profile lives in the app's data folder, so Citi remembers the device between runs.
- Goes straight to the Merchant Offers page after sign-in, which skips the paperless prompt.
- Searches for each available offer and clicks its enroll button, with random pauses, typing speed and click positions. Priority stores go first.
- Saves each offer's details from Citi's enroll response: description, terms, end date and website.
- Runs every few days at a random time inside a window you choose. If Citi asks for a verification code, the app notifies you and waits up to 10 minutes for you to finish signing in.

The Citi password is encrypted with Windows DPAPI and never leaves the PC.

## Data

Everything lives in `%APPDATA%\Offer Autopilot`:

- `offers.json`: every offer seen, per card, with details for the ones the app enrolled.
- `runs.json`: run history.
- `settings.json`: schedule, priority stores, and the encrypted password.
- `browser-profile\`: the automated browser's profile.

## Development

```
npm install
npm start
```

## Releases

Push a tag such as `v0.1.1` after bumping the version in `package.json`. The Release workflow builds the installer and publishes it as a GitHub release. Installed copies check for updates every 6 hours and install them when the app is idle.
