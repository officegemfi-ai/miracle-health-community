-- Miracle AI's chat: a smaller daily budget to start with. 1,000 messages a day for everyone
-- together (each answer costs a few cents of Claude); raise it here when the chat is busy.
update private.settings
   set value = '1000', note = 'Messages Miracle AI answers in a day (UTC), everyone together; each costs a few cents'
 where key = 'ask_per_day';
