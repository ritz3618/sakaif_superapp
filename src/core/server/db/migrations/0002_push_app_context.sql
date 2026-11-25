-- 通知の宛先を、どのアイコン(本体 "app" またはブラウザ "browser")から登録したかを記録する。
ALTER TABLE core_push_subscriptions ADD COLUMN app_context TEXT;
