-- Miracle AI is now Sig: the Community Signal in person, and Miracle Health's AI, in its chat
-- called Ask Sig on miraclehealth.us. The words members see in the game say so.
update public.point_rules set label = 'Confirming or correcting how Sig read your report' where reason = 'confirm';
update public.badges set description = 'Confirmed three of Sig’s reads' where key = 'receipts';
update public.quests set description = 'Post how it went for you: better, the same or worse. Sig reads it into the Signal.' where key = 'report';
update public.quests set title = 'Check one of Sig’s reads', description = 'Confirm or correct how Sig read one of your reports.' where key = 'confirm';

-- The settings that pause or limit the chat on the website
update private.settings set note = 'Ask Sig on the website: on, or off to pause it' where key = 'ask_enabled';
update private.settings set note = 'Messages one visitor can send Sig in ten minutes' where key = 'ask_per_visitor_10min';
update private.settings set note = 'Messages one visitor can send Sig in a day (UTC)' where key = 'ask_per_visitor_day';
update private.settings set note = 'Messages Sig answers in a day (UTC), everyone together; each costs a few cents' where key = 'ask_per_day';
