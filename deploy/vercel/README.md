# Vercel front door

A nicer address for the hosted pilot. Vercel runs no app code: one rewrite forwards every
request to the Modal app. The `Deploy Vercel front door` workflow writes `vercel.json` with the
current Modal URL and deploys this folder, so the address can't drift from Modal.

Real student data belongs on the school's own server, not on Vercel or Modal.
