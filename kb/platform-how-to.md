# Platform How-To

## 2-1 Account Overview

### app-001
Q: What am I looking at on my dashboard?
A: The dashboard is the overview of your entire account. It shows your total messages sent, how many replies you've gotten, how many motivated sellers you have, and how many deals you've had over the month. You can filter it by time and edit what it shows.

### app-002
Q: Why did the numbers on my dashboard change?
A: The dashboard numbers are based on opportunity status. As you move opportunities through your pipeline, the dashboard updates to match.

### app-003
Q: Can I schedule calls with sellers inside REIblast?
A: Yes. In Calendars you can set up a personal calendar and book appointments, such as a time to call a seller or a Zoom or Google Meet. You can also connect it to your Google Calendar.

### app-004
Q: Who are these contacts already in my account?
A: Your account starts with example contacts. You can delete them from Contacts to start fresh before you import your own list.

### app-005
Q: Where can I see where my leads are in the process?
A: In Opportunities, which is your pipeline. It shows where each lead stands, such as whether they've been texted, replied, are interested, or are under contract. Leads move through the pipeline stages automatically as they're messaged and respond.

### app-006
Q: Where do my REIscore deal analyses show up?
A: If you push deals from REIscore into the CRM, they show up in Analyze Deals, which gives you an overview of everything you've pulled from REIscore. Note that REIscore is currently disabled.

### app-007
Q: Do I need to set up payments?
A: Only if you plan to take payments from people in the future, in which case you can set up a payment gateway in Payments. Otherwise, the main thing you'll use in Payments is the contract templates.

### app-008
Q: Do I need to use AI Studio or Memberships?
A: No. You don't need to worry about either one.

### app-009
Q: Can I save quick replies so I don't have to type the same text every time?
A: Yes. In Marketing you can set up text snippets (also called canned messages) for quick replies, as well as email templates.

### app-010
Q: Where's my website?
A: In Sites. Every REIblast account gets a generic template website that's filled in for you, and its main purpose is to help you get approved for A2P. You can also use Sites to build your own funnels, forms, and other websites.

### app-011
Q: Can I edit or change my A2P website?
A: No. Do not touch the template website REIblast set up for you, because it's part of what keeps your A2P registration consistent. If you want your own site, funnel, or form, build a separate one in Sites.

### app-012
Q: Where can I store photos, contracts, and other files?
A: In Media Storage. You can upload property photos, contracts, flyers, videos, and other files so they're easy to find. Think of it as Google Drive inside REIblast.

### app-013
Q: How do I track what my VAs are doing?
A: Use Reporting. You can see each team member's numbers, like calls made and text messages sent, along with a range of other activity.

### app-014
Q: How do I get into REItools, REIscore, or REIscrub?
A: Click REItools in the left sidebar to open the tools dashboard. You'll log in with a one-time password, which is texted to your personal phone from the REIblast support number. Every member has access to REIscore and REIscrub from day one, though REIscore is currently disabled.

### app-015
Q: Where do I add users or buy phone numbers?
A: Both are in Settings, at the bottom of the left sidebar. That's also where you change any of your account settings.

### app-016
Q: Is there a map of everything in my account?
A: Yes. There's a downloadable account map in the course resources that you can keep handy as a quick visual reference to everything in your account.

## 2-4 Your Built-In Automations

### app-017
Q: What automations come with my account?
A: Your account comes with two locked automation folders. The SMS Flow Campaign folder is the text blast machine that sends your blasts. The Internal Workflow folder runs everything behind the scenes that keeps your system working and compliant.

### app-018
Q: Can I edit the built-in automations?
A: No. The two built-in folders are locked, and REIblast only updates them when something breaks or when an update goes out to all members. If you need changes, contact support. You're free to create your own automations, and they'll show up on the Automation page.

### app-019
Q: What happens when a text goes to a bad or inactive number?
A: The messaging error fail-safe catches the most common SMS errors, like bad or inactive numbers. It adds a tag, turns on Do Not Disturb for calls and SMS on that contact, and removes the contact from all the workflows they're in.

### app-020
Q: How do I stop a lead from getting any more automated texts?
A: Add the tag "Remove from All - Dead Lead" to the contact. That removes them from all automations so they don't receive any more text messages.

### app-021
Q: What happens when a lead replies to my blast?
A: Any reply to one of the three preloaded SMS flows creates an opportunity named after the contact in the Lead Replied stage of the text blast pipeline. It also adds a "replied" tag and removes the lead from all workflows so they stop getting automated texts.

### app-022
Q: Why did a contact get Do Not Disturb turned on automatically?
A: Every contact added to the CRM runs through number validation. If the number comes back as SMS incapable or not valid, such as a landline, Do Not Disturb for SMS is turned on automatically. Do Not Disturb is also turned on when a send hits a common error like a bad or inactive number.

### app-023
Q: Why are there three SMS flows?
A: All three flows are structured the same way; only the wording changes. Splitting contacts across slightly different messages keeps it from looking like you're sending the exact same text to thousands of people.

### app-024
Q: What texts does the blast send, and when?
A: Each flow sends seven texts spaced out over about 30 days: the intro message, then follow-ups after 1 day, 2 days, 3 days, 5 days, 5 days, and a week. The opt-out language is added to the end automatically. After the seventh message, if there's still no reply, the opportunity moves to No SMS Response.

### app-025
Q: What does the first blast text say?
A: In Flow 1 it reads like: "Hey John, this is Steven. I drove past 123 Main Street the other day and I was wondering if you were the owner," with your opt-out language added to the end. The name, your name, and the address are merge fields filled in from each contact. Flows 2 and 3 use slightly different wording.

### app-026
Q: Why are the follow-up texts spaced so far apart?
A: Text blasting means sending to many people at once, not sending a bunch of messages to one person in quick succession. Spacing out the follow-ups keeps you within the texting rules.

### app-027
Q: Where do my leads show up in the pipeline during a blast?
A: After the first text sends, the lead gets an opportunity in the Messaged stage of the text blast pipeline. After three texts with no reply, it moves to 3rd Message No Reply. After the final text with no reply, it moves to No SMS Response. If they reply at any point, it moves to Lead Replied.

### app-028
Q: What are the SMS tags on my contacts for?
A: As a contact moves through a flow, it's tagged with the message it's about to receive (SMS 1, SMS 2, and so on). If a send fails, for example because you ran out of funds or hit your limit, the contact is removed from the flow but keeps that tag, so when you add it back, the blast picks up at the message it was on. Don't change these tags yourself, or the blast won't know where to resume.

### app-029
Q: A send failed partway through my blast. Do my leads have to start over?
A: No. When a send fails, the contact is removed from the flow but keeps the tag for the message it was on. Add the contact back to the blast and it skips ahead to that message, all the way through to the seventh. This only works if you leave the SMS tags alone, so don't add, remove, or edit them yourself.

## 3-5 Working the Pipeline

### app-030
Q: I sent my blast. Now what do I do?
A: Work your pipeline. Every day, check the Lead Replied stage, respond to each reply quickly, and move each person to where they belong: Interested if they're open to selling, or Dead/Lost Lead if they're not interested or opted out. Most of the pipeline moves on its own; Lead Replied is where your work is.

### app-031
Q: What are the stages in my pipeline and how do they work?
A: Your Text Blast pipeline has these stages: Messaged, 3rd Message No Reply, Lead Replied, Interested, Offer Made, Contract Signed, No SMS Response, and Dead/Lost Lead. Messaged, 3rd Message No Reply, No SMS Response, and Lead Replied move automatically through the automations. Interested, Offer Made, Contract Signed, and Dead/Lost Lead are yours to manage after you've talked to the lead.

### app-032
Q: Which leads do I need to move myself?
A: Only leads that have replied. The automations move leads into Messaged, 3rd Message No Reply, No SMS Response, and Lead Replied on their own. After someone replies, you move them to Interested, Offer Made, Contract Signed, or Dead/Lost Lead.

### app-033
Q: Someone hasn't replied to my first text. Should I follow up?
A: No, there's nothing for you to do. Most people don't answer the first text. They stay in Messaged, and your follow-up messages keep reaching out automatically.

### app-034
Q: A lead got three texts and never replied. What should I do?
A: Nothing. The automation moves them to 3rd Message No Reply on its own. A lot of people answer on the fourth or fifth message, so let the sequence keep going.

### app-035
Q: A lead got all seven texts and never replied. Should I keep texting them?
A: No. When the sequence finishes, they land in No SMS Response automatically. Seven texts with no answer is a clear signal, and piling on more texts is how numbers get flagged. You can let them rest, put them on a long-term drip (like one text a month), move them to Dead/Lost Lead, or try a phone call if the property looks like a strong deal, in case you had the wrong number.

### app-036
Q: Someone replied STOP. What do I do?
A: The opt-out works automatically: STOP or any other opt-out keyword opts them out and turns on Do Not Disturb, so they won't get another text. They still land in Lead Replied like any other reply, so add the tag "Remove from All - Dead Lead" to take them out of all workflows, then move them to Dead/Lost Lead.

### app-037
Q: Someone said "not interested, stop texting me" but didn't reply with just STOP. What do I do?
A: The automatic opt-out only catches the opt-out keyword, so this one is on you. Turn on Do Not Disturb for their contact so they never get another text, then move them to Dead/Lost Lead. Texting someone who asked you to stop is how you get reported, and reports hurt your number and can get your campaign suspended so you can't blast at all.

### app-038
Q: A seller said they might sell. What do I do?
A: Respond fast, because interest is highest right after a reply. Answer quickly, try to get them on the phone, and once you've talked and they're open to an offer, move them to Interested. On the call, get the property's condition, their motivation, their price, and their timeline so you can make an offer.

### app-039
Q: How do I see only the leads that replied?
A: In Contacts, click Filters and select Opportunity Stage. Choose the Text Blast pipeline and the stage you're working (like Lead Replied), then click Apply. Open the first contact and use the arrows at the top to move through each one.

### app-040
Q: How do I move a lead to a different stage?
A: Open the conversation with the contact. Any opportunity stage change shows up in the conversation with a Details link; click Details, and in the menu that pops up, change the opportunity stage, for example to Interested or Dead/Lost Lead.

### app-041
Q: Most of my leads ended up in Dead/Lost Lead. Is something wrong?
A: No. The majority of the people you blast will end up in Dead/Lost Lead. That's normal; text blasting works because you can reach thousands of people a day and get a few interested sellers.

### app-042
Q: How much time do I need to put into working my pipeline?
A: You don't need to spend eight hours a day, but it takes consistent effort. Blasting every day, uploading lists, and working Lead Replied daily will get you a deal faster than treating it as a part-time afterthought.

## 3-6 Using the Built-In Contract

### app-043
Q: Can I send a contract to a seller from inside REIblast?
A: Yes. REIblast has a purchase and sale agreement built in, so you can send it and get it signed from inside your account without using DocuSign or another e-signature tool.

### app-044
Q: Where do I find the contract?
A: Go to Payments, then Documents & Contracts, then Templates. The REIblast Purchase and Sale Agreement there is a universal wholesaling agreement, the same one that's available in the Discord.

### app-045
Q: How does the contract get filled in?
A: The contract fills in automatically from merge fields on the seller's contact record, using the Property Info, Seller Info, Deal Info, and Wholesaler Info sections on the contact. Fill those out and save the contact before you send the contract.

### app-046
Q: What should I put in the contract fields, like closing date, earnest money, or inspection period?
A: Ask in the community, or book a support call using the booking link in the Support Calendar channel. They can walk you through what to enter for your deal and your state.

### app-047
Q: How do I send the contract to a seller?
A: Make sure the seller's contact info is filled out and saved. Then go to Payments, then Documents & Contracts, then Templates. Click the three dots next to the REIblast Purchase and Sale Agreement and choose Use Template. Under Recipients, set a signing order, add the seller as a contact, and make sure the seller signs first. Preview it, then send.

### app-048
Q: Who should sign the contract first?
A: The seller. Set a signing order so the seller signs first, then you sign.

### app-049
Q: Can I send the contract by text instead of email?
A: Yes. You can send it by email, by SMS, or by both.

### app-050
Q: Why are fields on my contract blank or wrong?
A: The contract pulls its information from the seller's contact record. If something is blank or wrong, update the info on the contact, save it, and preview the contract again before sending.

### app-051
Q: How do I know when the contract has been signed?
A: Each signer gets an email when their signature is received, and once everyone has signed, you get an email saying all parties have signed. You can also check Payments, then Documents & Contracts, which shows every document you've sent, which are waiting on signatures, and which are completed.

### app-052
Q: Is the built-in contract valid in my state?
A: It's a universal wholesaling purchase and sale agreement that works in most states, but that isn't guaranteed. Before you use it, have legal counsel, a title company, or someone else qualified in your state review it to make sure it's valid there and nothing needs to change.

### app-053
Q: My state needs a different contract. What do I do?
A: Book a support appointment using the booking link in the Support Calendar channel in the Discord. Support will go through your contract with you and make sure your CRM has the fields it needs, so your contract can fill in automatically too.

### app-054
Q: Can I upload my own contract?
A: Yes. You can upload your own contracts and templates and create custom fields so they fill out automatically.
