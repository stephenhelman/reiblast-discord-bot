# Sending & Troubleshooting

## 3-2 Purchasing Phone Numbers

### snd-001
Q: How many phone numbers can I have?
A: It depends on how you're registered. LLCs can have unlimited phone numbers attached to their A2P campaign. Sole proprietors get one phone number per campaign. If you're a sole proprietor with an EIN registered with the IRS, you follow the LLC rule and can have unlimited numbers.

### snd-002
Q: I'm a sole proprietor without an EIN. Can I ever use a different number?
A: Yes. You're limited to one phone number attached to your A2P campaign, but you can switch your campaign from one phone number to another.

### snd-003
Q: I bought a number. Why won't it send texts?
A: Your number won't send texts until your A2P registration is approved. Once it's approved, your blasts go out from that number.

### snd-004
Q: Do I need to buy my first phone number?
A: No. REIblast buys your first phone number and assigns it to you when your A2P campaign is set up. If you want more numbers after that, you can buy them yourself.

### snd-005
Q: How do I buy another phone number?
A: Go to Settings, then Phone System, and click Add Number. Filter for United States, choose a local number (not toll-free), and make sure SMS, MMS, and voice capabilities are selected. Search by digits using your market's area code, matched to the first part of the number, click Apply, select the number you want, and proceed to buy.

### snd-006
Q: How do I get a phone number in the area I'm texting?
A: Find the area code for the market you're targeting. When buying a number, search by digits with that area code matched to the first part of the number, and you'll get local numbers from that area to choose from.

### snd-007
Q: Should I get a toll-free number?
A: No. Choose a local number with an area code that matches the market you're targeting, and make sure it has SMS, MMS, and voice capabilities.

### snd-008
Q: How much does a phone number cost?
A: Each phone number costs $1.21 per month, charged on the same day each month as when you bought it. The charge comes out of your wallet, not directly from your bank account.

### snd-009
Q: How do I know if my number is attached to my A2P campaign?
A: In Settings, then Phone System, each number in your list shows its name, whether it's your default number, and whether it's attached to a campaign.

### snd-010
Q: How do I link or unlink a phone number from my campaign?
A: In Settings, then Phone System, click the three dots next to the number. From there you can view number info, select the campaign to link it to, unlink it from a campaign, or edit its configuration.

### snd-011
Q: Can I forward calls from my texting number to my cell phone?
A: Yes. Click the three dots next to the number and edit its configuration. There you can route calls to a user, turn on call forwarding, enable call recording, and set up advanced options like a whisper message.

### snd-012
Q: What is a whisper message?
A: If calls to your texting number forward to your cell phone, a whisper message is what you hear when you answer, before you're connected to the caller. If you don't set one, you'll hear a default message saying the call is connecting, you have a new lead, and to press any button to continue.

### snd-013
Q: What number does REIblast text me from?
A: REIblast messages members from the REIblast HQ number, 915-800-8266, which is also the support number. Save it in your phone so you don't miss messages from REIblast.

## 3-3 Importing a List

### snd-014
Q: What kind of phone numbers should be in my list?
A: Only mobile numbers. REIblast is built to text blast, so landlines, VoIP numbers, and desk phones can't receive your texts. Your list should also have DNC (Do Not Call) numbers removed.

### snd-015
Q: Why should I clean my list before uploading it?
A: If you upload a list without scrubbing it, you end up texting numbers that aren't mobile, like landlines, VoIPs, and desk phones. Each of those logs an error on your SMS campaign, and the more errors you get, the faster your campaign gets restricted.

### snd-016
Q: Do I need to scrub my list for DNC?
A: Your list should have no DNC numbers. Most lead providers scrub against the Do Not Call list automatically when you export your leads, but you can also clean your list yourself or use REIscrub, which removes both non-mobile numbers and DNC numbers automatically.

### snd-017
Q: What is REIscrub?
A: REIscrub is a tool inside REItools that cleans your lead list by automatically removing every number that isn't mobile and every number that's on the DNC list. It works with lists from BatchLeads, PropStream, and DealMachine.

### snd-018
Q: How do I scrub my list with REIscrub?
A: Click REItools in the left sidebar of your CRM and log in with the one-time passcode sent to your phone. Launch REIscrub, open BatchLeads Import, add your lead list, and process the file. Review the results, then download the cleaned file as a CSV and give it a name that tells you what it is (for example, "Land Ohio Mobile Scrub").

### snd-019
Q: Can I use REIscrub with PropStream or DealMachine lists?
A: Yes. The import option is called BatchLeads Import because it was originally built for BatchLeads, but it now works with BatchLeads, PropStream, and DealMachine lists.

### snd-020
Q: What does REIscrub show me after processing my list?
A: It shows the total records in your file, how many had mobile numbers, how many duplicates were found, and how many leads are ready to import. It also previews the cleaned data (first name, last name, address, city, state, zip, phone, and email) in the exact format of the file you'll download.

### snd-021
Q: Can REIscrub send my list straight into my CRM?
A: Not yet. For now, download the cleaned CSV from REIscrub and import it into your contacts. A feature to push lists straight to the CRM is planned.

### snd-022
Q: Why can't I get into REItools?
A: If your subscription is canceled, paused, or not active, you won't be able to get into REItools and you'll see an error message. Make sure your account is active.

### snd-023
Q: Is REIscore working?
A: REIscore is currently disabled. REIscrub is working.

### snd-024
Q: How do I import my leads?
A: Go to Contacts and click Import, then Start CSV Import. Choose Contacts as what you're importing, upload your CSV, choose "Create and update contacts," and click Next. Check the field mapping, make sure Property Address is mapped to Street Address, create a Smart List for the import, and start the import.

### snd-025
Q: Should I choose "Create contacts" or "Create and update contacts" when importing?
A: Always choose "Create and update contacts." With create and update, a duplicate lead updates the existing contact, so if that person already opted out, the contact stays marked Do Not Disturb. If you only create contacts, a duplicate becomes a brand new contact without Do Not Disturb, and if you text someone who already opted out, you've broken the law.

### snd-026
Q: My list got smaller after I imported it. Why?
A: When you use "Create and update contacts," duplicate leads update existing contacts instead of creating new ones, so your list may shrink depending on how many duplicates it had, such as leads with the same phone number. That's what keeps you from texting people who already asked not to be texted.

### snd-027
Q: What fields do I need to map when importing?
A: Most fields map automatically: first name, last name, city, state, zip, phone, and email. The one that usually doesn't map is the property address, so choose Street Address for it. If your CSV has extra columns you don't want to import, you can skip them.

### snd-028
Q: Should I add tags or a workflow when importing a list?
A: Not on your first run. Just create a Smart List. As you get more experienced, you can tag contacts or put them straight into the text blast during import.

### snd-029
Q: What is a Smart List and why should I make one when importing?
A: A Smart List is a saved filter that lets you pull up a specific group of contacts right away without filtering again. Create one every time you import a list, and name it so you know what's in it, like "Ohio Vacant Land 10-8."

### snd-030
Q: I started an import but my contacts aren't showing up. Is it broken?
A: The import takes a little time to process. In Contacts, open Bulk Actions (to the right of Smart Lists) to see the import and what percentage has processed, and click its statistics to see how many contacts have been imported so far. When it finishes, you can view the uploaded contacts from Actions or open the Smart List you created.

### snd-031
Q: Where can I see my past imports?
A: When you start a CSV import in Contacts, there's a record of every import you've done in the system.

## 3-4 Blasting a List

### snd-032
Q: How do I send my first blast?
A: Open the Smart List (or imported contacts) you want to text in Contacts and select the contacts. Click Trigger, give the action a name, and choose the Start SMS Blast workflow. Set your sending schedule (a scheduled time or drip mode), then click Add to Automation.

### snd-033
Q: What are the steps to get a blast going?
A: Four steps: get your phone number, clean your list, import it, and add it to the Start SMS Blast automation. REIblast buys your first phone number and assigns it to you when your A2P campaign is set up, so in practice you just get your list, scrub it, import it, and blast it.

### snd-034
Q: Which workflow do I add my contacts to?
A: Always start with the Start SMS Blast workflow. It has no trigger of its own; you add contacts to it directly. It assigns each contact to you as the user (REIblast sets this up), so your texts say who they're from, then splits contacts evenly across SMS Flow 1, 2, and 3.

### snd-035
Q: Should I send to my whole list at once?
A: It works, but it isn't recommended when you're sending thousands of texts. Sending everything at once can overload the system, cause a lot of opt-outs and errors, and keep some messages from sending. Use drip mode to send in batches instead.

### snd-036
Q: What drip settings should I use?
A: The recommendation is 10 messages every 1 minute, which works out to about one message every six seconds. It's a recommendation, not a hard limit: you can go higher, like 20 or 30 per minute, or send everything at once. Just know that overloading the system can lead to a lot of errors.

### snd-037
Q: How do I set up drip mode?
A: When you add contacts to the automation, choose drip mode. Pick when it starts, how many contacts to send per batch, how often to repeat, and which days to run, then click Add to Automation.

### snd-038
Q: Can I schedule a blast for later?
A: Yes. When you add contacts to the automation, you can set a specific time for it to start or use drip mode. Even if you add contacts at midnight, the automation won't text anyone outside its allowed sending hours.

### snd-039
Q: How do I check that my blast is running?
A: Open Bulk Actions in Contacts. Your blast shows up under the name you gave it, with the operation listed as Workflow, its status, and statistics you can click into.

### snd-040
Q: What else can I do with contacts I've selected?
A: Once you select contacts, you can export them, trigger an automation, send an email or mass email, add tags, delete them, send WhatsApp messages, or request reviews.

## 3-7 Troubleshooting

### snd-041
Q: My texts aren't going through. What should I check first?
A: Check two things before anything else, because they cause the large majority of texting problems: Is your A2P registration approved? Does your wallet have money in it? If either one is the issue, nothing else matters yet. If both are good, open the failed message and check its status and error code.

### snd-042
Q: How do I find out why a text failed?
A: Open the contact's conversation and click the message that failed. Failed messages usually show a red triangle; hover over it to see the five-digit error code and sometimes a description. Write the code down, since it points to the fix and it's the first thing support will ask for.

### snd-043
Q: What do the message statuses mean?
A: Pending or Queued means the message is waiting to send; a few moments is normal, but if it's stuck for a long time, check your A2P and wallet. Sent means it reached the carrier but delivery isn't confirmed. Delivered is the only status that means the text landed on the phone. Undelivered means the carrier took it but couldn't deliver it, usually because of a landline, carrier filtering, or a bad number. Failed means it never left your account, usually because of A2P, your wallet, your number, or the person having opted out.

### snd-044
Q: My texts say "Sent." Does that mean they were delivered?
A: No. Sent only means the message reached the carrier. Delivered is the only status that confirms the text landed. If you're seeing a lot of Sent but not Delivered, that's usually carrier filtering.

### snd-045
Q: What does error 21610 mean?
A: The person opted out by replying STOP or another opt-out keyword, or they're marked Do Not Disturb. Don't try to resend; remove them from your active lists. If they text START, Do Not Disturb is turned off and you can text them again.

### snd-046
Q: What does error 21635 or 21661 mean?
A: You're texting a landline, or the number you're sending from isn't set up to text. Remove landlines from your list and double-check that your own number is SMS capable. The number REIblast sets up for you during A2P is always SMS capable; numbers you buy yourself need SMS capability selected when you buy them.

### snd-047
Q: What does error 30003 mean?
A: The recipient's phone was off, in airplane mode, or had no signal. It's usually temporary, so it's fine to try again later. If you see it across a lot of contacts at once, it's more likely filtering than bad luck.

### snd-048
Q: What does error 30005 mean?
A: The number is inactive or doesn't exist. Remove it, and clean your list before importing. Skip-traced data is never 100% accurate, so a few of these are normal, but if you see it across a lot of contacts, it's a data quality problem.

### snd-049
Q: What does error 30006 mean?
A: It's another landline code, or the recipient's carrier can't receive texts. Remove landlines and clean your list before you import.

### snd-050
Q: What does error 30007 mean?
A: The carrier filtered your message because it looked like spam. This is the most important error to understand. Rewrite your message so it sounds personal and plain, like a real person wrote it: remove shortened links, avoid spammy words, all caps, lots of exclamation points, and emojis, vary the wording across your list, and always say who you are and include opt-out language.

### snd-051
Q: What does error 30008 mean?
A: It's an unknown error. Try again. If it keeps happening, collect a few examples and contact support.

### snd-052
Q: What does error 30032 or 30034 mean?
A: Your number's registration isn't complete, which means your A2P isn't approved yet. Nothing will send until it is.

### snd-053
Q: My blast isn't sending or is stuck on pending. What's wrong?
A: It's almost always one of four things, in this order: your A2P isn't approved yet, so check your registration status; your wallet is empty, so add funds; you don't have an SMS-capable, registered number; or you've hit your daily ramp-up limit, in which case wait until tomorrow or split your blast across a few days. Checking the first two clears up most cases.

### snd-054
Q: My texts show sent but nobody is getting them. Why?
A: If you're seeing Sent or Undelivered with error 30007, the carriers are filtering your messages as spam. Common triggers are links (especially shortened links like bit.ly), spammy words, all caps, lots of exclamation points or emojis, sending the exact same message to a big list, or a number with complaints against it. Rewrite your message to sound personal, remove shortened links, vary the wording, and always include who you are and your opt-out language.

### snd-055
Q: I got error 30007 on a text I sent manually. Why?
A: Error 30007 doesn't only apply to blasts. If a message you sent by hand gets filtered, its wording contained language the carriers didn't approve of. Rewrite it so it's A2P compliant and send it again.

### snd-056
Q: My blast started sending and then stopped partway through. Why?
A: You hit a ceiling, and there are only two reasons. Either your wallet ran out of money partway through and couldn't recharge (for example, because your card on file expired, was declined, or didn't have enough money), or your number hit its daily ramp-up limit. Check your wallet first; if it's empty, fix your card or add funds and the rest can go out. If your wallet had money, it's the ramp-up limit, and sending picks back up tomorrow.

### snd-057
Q: How do I avoid hitting my daily limit in the middle of a blast?
A: While your number is still ramping up, split big blasts across a few days instead of sending everything at once.

### snd-058
Q: Some contacts got my text and others didn't. Is something wrong?
A: No, partial delivery is normal on every list and is almost always about the numbers, not your account. Landlines can't receive texts, invalid or inactive numbers fail, and anyone who's opted out or on Do Not Disturb gets skipped. Clean your list before you blast, and check a few failed messages: codes like 21610, 30005, or 30006 mean it's the numbers.

### snd-059
Q: My blast automation is grayed out or won't run. Is it broken?
A: No. Sending features stay locked until your A2P registration is approved. That's the carriers, not something REIblast can switch on early. Once your A2P is approved, your automations unlock on their own with nothing for you to do.

### snd-060
Q: My wallet won't recharge or a charge failed. What do I do?
A: A failed charge means your card was declined, for any reason, such as being expired, locked, short on funds, or flagged by your bank. Since everything you send draws from your wallet, a failed charge stops your texts, and after three failed recharges your account is paused. Update or unlock your card in Settings, then Billing, then Payments, add funds to your wallet manually, and make sure auto recharge has a low balance limit and recharge amount set.

### snd-061
Q: My number was working and then stopped. What happened?
A: It's usually been flagged or suspended, almost always after spam complaints or a run of 30007 errors. Look at what you've been sending and how many people are opting out. A badly burned number is sometimes better replaced than saved. If you think your number has been suspended, contact support.

### snd-062
Q: My import failed or some of my contacts are missing. What's wrong?
A: It's almost always the file, not the account. Common causes are wrong or missing column headers, inconsistently formatted phone numbers, rows missing a phone number or other required field (which get skipped), or contacts that came in marked Do Not Disturb. Start from a clean file with clear headers and one contact per row, format every phone number the same way (ideally +1 followed by the 10 digits), and after importing, compare the number of contacts that came in against your file. If they don't match, fix the skipped rows and re-import just those.

### snd-063
Q: My import still hasn't shown up. What should I do?
A: Give it a few minutes and check Bulk Actions in Contacts to see its progress, since large lists (like 5,000 contacts) take time. If it still hasn't uploaded after an hour, contact support. Lists cleaned with REIscrub are already formatted to import without issues.

### snd-064
Q: Where do I see replies to my texts? I can't find them.
A: Every reply lands in that contact's conversation in Conversations, not in the blast tool or the automation. In Conversations, new replies show as Unread, All shows everything, and Recent sorts by most recent. Anyone who replies also moves to Lead Replied in your pipeline. If you're not getting pinged, turn on your notifications so you know the moment someone answers.

### snd-065
Q: How do I keep my number from getting flagged or shut down?
A: Follow the texting rules: respect the ramp-up period and don't blast a new number at full volume, always say who you are and include opt-out language, text people who'd expect to hear from you or have real motivation, remove cold leads who never respond, and keep messages personal and varied instead of one identical mass blast. Carriers suspend numbers that show lots of STOP replies, spam complaints, or too much volume too fast.

### snd-066
Q: My number got flagged. What do I do?
A: Stop sending, figure out what triggered it, and contact support. A badly burned number may need to be replaced rather than saved.

### snd-067
Q: When should I contact support?
A: Contact support if your A2P shows approved and messages still fail, if the same error keeps happening across many contacts even after cleaning your list and rewriting your message, if your number was suspended and needs to be reviewed or replaced, or if a payment problem won't clear after you've updated your card.

### snd-068
Q: What should I send support so they can fix my issue fast?
A: Send three things up front: the error code and message status, at least three example messages from the last 24 hours (with which contacts and what time), and what you've already tried. That usually lets support fix it in one round.

### snd-069
Q: Can I book a support call for a texting problem?
A: Yes, using the booking link in the Support Calendar channel in the Discord, but make sure you've done the troubleshooting first: check that your A2P is approved, check that your wallet is funded, and look up the error code on the failed message. Support calls are for legitimate blockers that troubleshooting can't fix. If you book a call without having done the troubleshooting yourself, the call will be cancelled.

### snd-070
Q: Is there a troubleshooting guide I can keep?
A: Yes. The Troubleshooting Guide in the course resources covers every common texting problem, including the full error code table, and the troubleshooting slide deck is there too.
