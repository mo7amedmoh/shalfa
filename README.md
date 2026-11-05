# منصة إدارة مشروع إدارة المرافق المدرسية

واجهة عربية RTL لإدارة بيانات المدارس وخطط المرافق والقوى العاملة ومؤشرات الأداء.

## المتطلبات المحلية

- Node.js LTS وnpm.
- مشروع Supabase مجاني (Postgres وAuth وRLS وStorage). لا يحتاج هذا المشروع إلى خادم مخصص أو مفتاح خدمة داخل المتصفح.

## التشغيل

1. انسخ `.env.example` إلى `.env.local` وأضف `VITE_SUPABASE_URL` و`VITE_SUPABASE_PUBLISHABLE_KEY` من إعدادات مشروع Supabase. إذا غاب أحدهما تعرض شاشة الإعداد اسمه فقط دون كشف أي قيمة. يمكن استخدام مفتاح anon القديم كبديل للمفتاح العام. لا تضع `service_role` أو أي مفتاح سري في ملف عميل أو إعدادات بناء الواجهة.
2. نفّذ `npm install`.
3. تأكد من تطبيق المخطط المرجعي `docs/reference/001_shalfa_schema_rls.sql` مرة واحدة، ثم طبّق الترحيل الإضافي الوحيد في `supabase/migrations/`.
4. أنشئ المستخدم الأول من Supabase Auth ببريده الكامل؛ ينشئ trigger الملف في `profiles`. بعد التحقق من هويته، غيّر دوره من SQL Editor مثلاً عبر `update public.profiles set role = 'admin' where username = 'your_username';`.
5. لنشر وظيفة إنشاء الحسابات الآمنة: ثبّت Supabase CLI، ثم نفّذ `supabase functions deploy create-user`. تحقّق من توفر `SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` كأسرار بيئة الوظيفة؛ لا تضع مفتاح الخدمة في `.env.local` أو إعدادات واجهة الويب. الوظيفة تتحقق من دور مدير النظام، ويُسجل إنشاء الملف بواسطة trigger قاعدة البيانات.
6. شغّل `npm run dev`.

الأوامر المتاحة: `npm run lint`، `npm run typecheck`، `npm test`، `npm run build`.

يتحقق `npm run build` تلقائياً من أن JavaScript الابتدائي لا يتجاوز 400 KiB gzip. لتوليد تقرير تحليل الحزمة بصرياً استخدم PowerShell: `$env:ANALYZE='true'; npm run build`، ثم افتح `dist/stats.html`. راجع [تقرير الأداء](docs/PERFORMANCE.md) للقياسات والحدود المعروفة.

## مزامنة المدارس

بعد تسجيل مدير النظام، افتح «المزامنة والإعدادات» وأدخل اسم التبويب وعناوين الرقم الوزاري واسم المدرسة. يمكن ضبط مزامنة تلقائية عند دخول المدير وفق الفترة المحددة، كما تتوفر المزامنة اليدوية. يجب تأكيد أي أعمدة إحداثيات قبل إدخالها. المزامنة لا تحذف السجلات الغائبة من المصدر. يلزم تحديد التبويب/الإحداثيات والتحقق من سياسة RLS في مشروعك قبل استخدامها تشغيلياً.

## استيراد ملفات مؤشرات الأداء

ضع الملفين الرسميين في `docs/reference/` وشغّل `npm run seed:kpi` لإنتاج بيانات seed خاصة بالمستودع. بعد تطبيق المخطط، شغّل `npm run seed:kpi:database` و`npm run seed:checklist` من بيئة موثوقة تتوفر فيها `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY`؛ لا تُعرّض مفتاح الخدمة للعميل. تُحمّل واجهة مؤشرات الأداء وقائمة الفحص من قاعدة البيانات مع سياسات RLS، ولا تُخدّم كتالوجاتها من `public/`.

للتحقق من السياسات، عيّن `TEST_<ROLE>_EMAIL` و`TEST_<ROLE>_PASSWORD` لكل دور وشغّل `npm run verify:rls`. بيانات الاعتماد لا تُحفظ في المستودع.

## النشر المجاني

أنشئ موقعاً ثابتاً عبر Cloudflare Pages أو Netlify أو GitHub Pages:

- أمر البناء: `npm run build`
- مجلد النشر: `dist`
- أضف متغيري Vite السابقين كمتغيرات بيئة وقت البناء.
- على Cloudflare Pages انسخ `public/_headers` إلى جذر المخرجات عند النشر إذا لم ينسخ المضيف مجلد `public` تلقائياً؛ Vite ينسخه افتراضياً.
- أضف نطاق النشر إلى إعدادات Redirect URLs في Supabase Auth.

لا تضع بيانات المدارس أو الموظفين في ملفات ساكنة أو متغيرات عامة.

## حالة البيانات

عناوين Google Sheet ونتائج مراجعة مصنفات KPI موثقة في `docs/DATA_MODEL.md`. راجع `docs/QUESTIONS.md` للمدخلات التشغيلية المتبقية قبل مزامنة الإنتاج واعتماد المخرجات.
