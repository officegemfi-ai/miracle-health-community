-- Miracle Health community: the full library, stacks and suggestions.
--
-- The library grows from 71 compounds to the peptides, hormones, supplements and
-- medications members commonly take, plus the blends people buy pre-mixed. Each
-- entry has a family (Peptides, Hormones, Supplements, Medications, Blends), a
-- category (what people take it for) and aliases (brand names and nicknames), so
-- "Ozempic" finds semaglutide and "Wolverine" finds the BPC-157 + TB-500 blend.
--
-- A post can now name several compounds. One compound posts to its space, as
-- before. Two or more post to that exact stack: a space of its own, made the
-- first time someone posts it, with its own Signal. As the Community Signal
-- architecture says, a stack is scored only from reports of that exact stack, and
-- a compound's own number never mixes in what else people took with it. Every
-- post carries the compounds in it (posts.part_ids), so members can search for the
-- stack they run and see every report that includes it.
--
-- Members can suggest something the library is missing; moderators add it.

-- ---------------------------------------------------------------------------
-- The library
-- ---------------------------------------------------------------------------
alter table public.compounds
  add column kind text not null default 'compound' check (kind in ('compound', 'blend', 'stack')),
  add column family text not null default 'Supplements'
    check (family in ('Peptides', 'Hormones', 'Supplements', 'Medications', 'Blends', 'Stacks')),
  add column aliases text[] not null default '{}' check (cardinality(aliases) <= 30),
  add column stack_key text,
  add column created_by uuid references public.profiles (id) on delete set null;
-- A stack's name is its compounds' names joined with " + ", which can run long
alter table public.compounds drop constraint compounds_name_check;
alter table public.compounds add constraint compounds_name_check check (char_length(name) between 1 and 400);
alter table public.compounds add constraint compounds_stack_key_check
  check ((kind = 'stack') = (stack_key is not null));
create unique index compounds_stack_key_unique on public.compounds (stack_key) where stack_key is not null;
create index compounds_created_by_idx on public.compounds (created_by);

-- What a blend or a stack is made of
create table public.compound_parts (
  compound_id text not null references public.compounds (id) on delete cascade,
  part_id text not null references public.compounds (id) on delete cascade,
  primary key (compound_id, part_id),
  check (compound_id <> part_id)
);
create index compound_parts_part_idx on public.compound_parts (part_id);

-- The library itself: 300 entries. From now on moderators add to it in the app
-- (Moderation > Library), including what members suggest.
insert into public.compounds (id, name, family, category, aliases) values
  ('semaglutide', 'Semaglutide', 'Peptides', 'Metabolic & weight', array['Ozempic', 'Wegovy', 'Rybelsus', 'Sema', 'GLP-1']::text[]),
  ('tirzepatide', 'Tirzepatide', 'Peptides', 'Metabolic & weight', array['Mounjaro', 'Zepbound', 'Tirz', 'Tirze', 'GLP-1/GIP']::text[]),
  ('liraglutide', 'Liraglutide', 'Peptides', 'Metabolic & weight', array['Victoza', 'Saxenda', 'Lira']::text[]),
  ('retatrutide', 'Retatrutide', 'Peptides', 'Metabolic & weight', array['Reta', 'LY3437943', 'Triple agonist']::text[]),
  ('dulaglutide', 'Dulaglutide', 'Peptides', 'Metabolic & weight', array['Trulicity']::text[]),
  ('exenatide', 'Exenatide', 'Peptides', 'Metabolic & weight', array['Byetta', 'Bydureon']::text[]),
  ('survodutide', 'Survodutide', 'Peptides', 'Metabolic & weight', array['BI 456906']::text[]),
  ('mazdutide', 'Mazdutide', 'Peptides', 'Metabolic & weight', array['IBI362', 'LY3305677']::text[]),
  ('pemvidutide', 'Pemvidutide', 'Peptides', 'Metabolic & weight', array['ALT-801']::text[]),
  ('cagrilintide', 'Cagrilintide', 'Peptides', 'Metabolic & weight', array['Cagri', 'Amylin analog']::text[]),
  ('pramlintide', 'Pramlintide', 'Peptides', 'Metabolic & weight', array['Symlin']::text[]),
  ('aod9604', 'AOD-9604', 'Peptides', 'Metabolic & weight', array['AOD', 'Advanced Obesity Drug']::text[]),
  ('hghfrag', 'HGH Fragment 176-191', 'Peptides', 'Metabolic & weight', array['Frag 176-191', 'HGH frag', 'Fragment 176-191']::text[]),
  ('sermorelin', 'Sermorelin', 'Peptides', 'Growth-hormone axis', array['GRF 1-29', 'Geref']::text[]),
  ('tesamorelin', 'Tesamorelin', 'Peptides', 'Growth-hormone axis', array['Egrifta', 'Tesa']::text[]),
  ('cjc1295', 'CJC-1295 with DAC', 'Peptides', 'Growth-hormone axis', array['CJC-1295 DAC', 'CJC DAC', 'DAC:GRF', 'CJC-1295']::text[]),
  ('modgrf129', 'CJC-1295 no DAC (Mod GRF 1-29)', 'Peptides', 'Growth-hormone axis', array['Mod GRF 1-29', 'Modified GRF 1-29', 'CJC no DAC', 'CJC-1295 without DAC']::text[]),
  ('ipamorelin', 'Ipamorelin', 'Peptides', 'Growth-hormone axis', array['Ipa', 'Ipam']::text[]),
  ('ghrp2', 'GHRP-2', 'Peptides', 'Growth-hormone axis', array['Pralmorelin']::text[]),
  ('ghrp6', 'GHRP-6', 'Peptides', 'Growth-hormone axis', '{}'::text[]),
  ('hexarelin', 'Hexarelin', 'Peptides', 'Growth-hormone axis', array['Examorelin']::text[]),
  ('igf1lr3', 'IGF-1 LR3', 'Peptides', 'Growth-hormone axis', array['Long R3 IGF-1', 'IGF LR3', 'IGF-1']::text[]),
  ('igf1des', 'IGF-1 DES', 'Peptides', 'Growth-hormone axis', array['DES(1-3) IGF-1', 'IGF DES']::text[]),
  ('mgf', 'MGF', 'Peptides', 'Muscle & performance', array['Mechano growth factor', 'IGF-1Ec']::text[]),
  ('pegmgf', 'PEG-MGF', 'Peptides', 'Muscle & performance', array['Pegylated MGF', 'Pegylated mechano growth factor']::text[]),
  ('follistatin', 'Follistatin 344', 'Peptides', 'Muscle & performance', array['FST-344', 'Follistatin']::text[]),
  ('ace031', 'ACE-031', 'Peptides', 'Muscle & performance', array['Ramatercept']::text[]),
  ('bpc157', 'BPC-157', 'Peptides', 'Healing & recovery', array['Body Protection Compound', 'PL 14736', 'BPC', 'Bepecin']::text[]),
  ('tb500', 'TB-500', 'Peptides', 'Healing & recovery', array['Thymosin beta-4 fragment', 'TB4 fragment', 'TB 500']::text[]),
  ('tb4', 'Thymosin beta-4', 'Peptides', 'Healing & recovery', array['TB4', 'Tβ4', 'Thymosin beta 4']::text[]),
  ('pda', 'Pentadeca Arginate', 'Peptides', 'Healing & recovery', array['PDA', 'BPC-157 arginate', 'Pentadecapeptide arginate']::text[]),
  ('ghkcu', 'GHK-Cu', 'Peptides', 'Healing & recovery', array['Copper peptide', 'GHK copper', 'Copper tripeptide-1']::text[]),
  ('ara290', 'ARA-290', 'Peptides', 'Healing & recovery', array['Cibinetide']::text[]),
  ('ahkcu', 'AHK-Cu', 'Peptides', 'Skin & hair', array['Copper tripeptide-3']::text[]),
  ('matrixyl', 'Matrixyl (palmitoyl pentapeptide-4)', 'Peptides', 'Skin & hair', array['Palmitoyl pentapeptide-4', 'Pal-KTTKS']::text[]),
  ('argireline', 'Argireline (acetyl hexapeptide-8)', 'Peptides', 'Skin & hair', array['Acetyl hexapeptide-8', 'Acetyl hexapeptide-3']::text[]),
  ('snap8', 'SNAP-8 (acetyl octapeptide-3)', 'Peptides', 'Skin & hair', array['Acetyl octapeptide-3']::text[]),
  ('mt2', 'Melanotan II', 'Peptides', 'Skin & hair', array['MT2', 'MT-II', 'Melanotan 2']::text[]),
  ('afamelanotide', 'Melanotan I (afamelanotide)', 'Peptides', 'Skin & hair', array['Afamelanotide', 'Melanotan 1', 'MT1', 'MT-I', 'Scenesse']::text[]),
  ('kpv', 'KPV', 'Peptides', 'Gut & digestion', array['Lys-Pro-Val', 'Alpha-MSH fragment']::text[]),
  ('larazotide', 'Larazotide', 'Peptides', 'Gut & digestion', array['AT-1001']::text[]),
  ('teduglutide', 'Teduglutide', 'Peptides', 'Gut & digestion', array['Gattex', 'GLP-2 analog']::text[]),
  ('ta1', 'Thymosin alpha-1', 'Peptides', 'Immune & inflammation', array['TA1', 'Tα1', 'Thymalfasin', 'Zadaxin']::text[]),
  ('ll37', 'LL-37', 'Peptides', 'Immune & inflammation', array['Cathelicidin', 'CAP-18']::text[]),
  ('vip', 'VIP', 'Peptides', 'Immune & inflammation', array['Vasoactive intestinal peptide', 'Aviptadil']::text[]),
  ('thymalin', 'Thymalin', 'Peptides', 'Immune & inflammation', array['Thymalinum']::text[]),
  ('thymulin', 'Thymulin', 'Peptides', 'Immune & inflammation', array['Zinc-thymulin', 'FTS-Zn']::text[]),
  ('thymogen', 'Thymogen', 'Peptides', 'Immune & inflammation', array['Glu-Trp']::text[]),
  ('semax', 'Semax', 'Peptides', 'Cognition & focus', array['ACTH 4-10 analog']::text[]),
  ('nasemax', 'N-Acetyl Semax Amidate', 'Peptides', 'Cognition & focus', array['NA-Semax-Amidate', 'NA Semax', 'NASA']::text[]),
  ('dihexa', 'Dihexa', 'Peptides', 'Cognition & focus', array['PNB-0408']::text[]),
  ('cerebrolysin', 'Cerebrolysin', 'Peptides', 'Cognition & focus', array['FPF-1070']::text[]),
  ('p21', 'P21', 'Peptides', 'Cognition & focus', array['P021']::text[]),
  ('pinealon', 'Pinealon', 'Peptides', 'Cognition & focus', array['EDR peptide', 'Glu-Asp-Arg']::text[]),
  ('cortexin', 'Cortexin', 'Peptides', 'Cognition & focus', '{}'::text[]),
  ('selank', 'Selank', 'Peptides', 'Mood & stress', '{}'::text[]),
  ('naselank', 'N-Acetyl Selank Amidate', 'Peptides', 'Mood & stress', array['NA-Selank-Amidate', 'NA Selank']::text[]),
  ('dsip', 'DSIP', 'Peptides', 'Sleep', array['Delta sleep-inducing peptide']::text[]),
  ('pt141', 'PT-141', 'Peptides', 'Sexual health', array['Bremelanotide', 'Vyleesi']::text[]),
  ('kisspeptin', 'Kisspeptin-10', 'Peptides', 'Sexual health', array['Kisspeptin', 'KP-10', 'Metastin 45-54']::text[]),
  ('triptorelin', 'Triptorelin', 'Peptides', 'Hormone balance', array['Trelstar', 'Decapeptyl', 'Triptodur']::text[]),
  ('epithalon', 'Epitalon', 'Peptides', 'Longevity', array['Epithalon', 'Epithalone', 'AEDG']::text[]),
  ('motsc', 'MOTS-c', 'Peptides', 'Longevity', array['MOTSc']::text[]),
  ('humanin', 'Humanin', 'Peptides', 'Longevity', array['HNG']::text[]),
  ('ss31', 'SS-31', 'Peptides', 'Longevity', array['Elamipretide', 'Bendavia', 'MTP-131', 'SS31']::text[]),
  ('foxo4dri', 'FOXO4-DRI', 'Peptides', 'Longevity', array['Proxofim']::text[]),
  ('vilon', 'Vilon', 'Peptides', 'Longevity', array['Lys-Glu']::text[]),
  ('vesugen', 'Vesugen', 'Peptides', 'Heart & circulation', array['Lys-Glu-Asp', 'Khavinson bioregulator']::text[]),
  ('cortagen', 'Cortagen', 'Peptides', 'Cognition & focus', array['Khavinson bioregulator']::text[]),
  ('livagen', 'Livagen', 'Peptides', 'Liver & detox', array['Khavinson bioregulator']::text[]),
  ('cartalax', 'Cartalax', 'Peptides', 'Joints & bones', array['Khavinson bioregulator']::text[]),
  ('chonluten', 'Chonluten', 'Peptides', 'Immune & inflammation', array['Khavinson bioregulator']::text[]),
  ('ovagen', 'Ovagen', 'Peptides', 'Liver & detox', array['Khavinson bioregulator']::text[]),
  ('prostamax', 'Prostamax', 'Peptides', 'Hormone balance', array['Khavinson bioregulator']::text[]),
  ('testagen', 'Testagen', 'Peptides', 'Hormone balance', array['Khavinson bioregulator']::text[]),
  ('crystagen', 'Crystagen', 'Peptides', 'Immune & inflammation', array['Khavinson bioregulator']::text[]),
  ('pancragen', 'Pancragen', 'Peptides', 'Metabolic & weight', array['Khavinson bioregulator']::text[]),
  ('bronchogen', 'Bronchogen', 'Peptides', 'Immune & inflammation', array['Khavinson bioregulator']::text[]),
  ('glutathione', 'Glutathione', 'Peptides', 'Liver & detox', array['GSH', 'L-glutathione', 'Reduced glutathione', 'Liposomal glutathione']::text[]),
  ('testosterone', 'Testosterone', 'Hormones', 'Hormone balance', array['TRT', 'Test', 'Testosterone cypionate', 'Test cyp', 'Testosterone enanthate', 'Test E', 'Testosterone undecanoate', 'Testosterone gel', 'Testosterone cream', 'Depo-Testosterone', 'Xyosted', 'AndroGel', 'Testim', 'Jatenzo', 'Kyzatrex', 'Tlando', 'Aveed', 'Natesto']::text[]),
  ('hcg', 'hCG', 'Hormones', 'Hormone balance', array['Human chorionic gonadotropin', 'Pregnyl', 'Novarel', 'Ovidrel']::text[]),
  ('hmg', 'hMG', 'Hormones', 'Hormone balance', array['Human menopausal gonadotropin', 'Menopur']::text[]),
  ('fsh', 'FSH', 'Hormones', 'Hormone balance', array['Follicle-stimulating hormone', 'Follitropin', 'Gonal-f', 'Follistim']::text[]),
  ('gonadorelin', 'Gonadorelin', 'Hormones', 'Hormone balance', array['GnRH', 'LHRH', 'Factrel']::text[]),
  ('leuprolide', 'Leuprolide', 'Hormones', 'Hormone balance', array['Lupron', 'Eligard', 'Leuprorelin']::text[]),
  ('estradiol', 'Estradiol', 'Hormones', 'Hormone balance', array['E2', 'Estrace', 'Vivelle-Dot', 'Climara', 'Divigel', 'Estrogel', 'Evamist', 'Estradiol patch', 'Estradiol valerate', 'Delestrogen', 'Estradiol cypionate']::text[]),
  ('estriol', 'Estriol', 'Hormones', 'Hormone balance', array['E3']::text[]),
  ('progesterone', 'Progesterone (micronized)', 'Hormones', 'Hormone balance', array['Micronized progesterone', 'Prometrium', 'P4']::text[]),
  ('dhea', 'DHEA', 'Hormones', 'Hormone balance', array['Dehydroepiandrosterone', 'Prasterone']::text[]),
  ('pregnenolone', 'Pregnenolone', 'Hormones', 'Hormone balance', '{}'::text[]),
  ('levothyroxine', 'Levothyroxine (T4)', 'Hormones', 'Hormone balance', array['T4', 'Synthroid', 'Levoxyl', 'Tirosint', 'Unithroid', 'Euthyrox']::text[]),
  ('liothyronine', 'Liothyronine (T3)', 'Hormones', 'Hormone balance', array['T3', 'Cytomel']::text[]),
  ('ndt', 'Desiccated thyroid (NDT)', 'Hormones', 'Hormone balance', array['NDT', 'Armour Thyroid', 'NP Thyroid', 'Nature-Throid', 'WP Thyroid']::text[]),
  ('hydrocortisone', 'Hydrocortisone', 'Hormones', 'Hormone balance', array['Cortisol', 'Cortef']::text[]),
  ('somatropin', 'Somatropin (HGH)', 'Hormones', 'Growth-hormone axis', array['HGH', 'GH', 'Growth hormone', 'rHGH', 'Genotropin', 'Norditropin', 'Omnitrope', 'Humatrope', 'Saizen', 'Serostim', 'Zomacton']::text[]),
  ('mecasermin', 'Mecasermin (IGF-1)', 'Hormones', 'Growth-hormone axis', array['Increlex', 'rhIGF-1']::text[]),
  ('insulin', 'Insulin', 'Hormones', 'Metabolic & weight', array['Humalog', 'Novolog', 'Lantus', 'Humulin', 'Tresiba']::text[]),
  ('oxytocin', 'Oxytocin', 'Hormones', 'Mood & stress', array['Pitocin']::text[]),
  ('teriparatide', 'Teriparatide', 'Hormones', 'Joints & bones', array['Forteo', 'PTH 1-34']::text[]),
  ('abaloparatide', 'Abaloparatide', 'Hormones', 'Joints & bones', array['Tymlos']::text[]),
  ('calcitonin', 'Calcitonin', 'Hormones', 'Joints & bones', array['Miacalcin']::text[]),
  ('metformin', 'Metformin', 'Medications', 'Longevity', array['Glucophage', 'Glumetza', 'Fortamet']::text[]),
  ('rapamycin', 'Rapamycin', 'Medications', 'Longevity', array['Sirolimus', 'Rapamune', 'Rapa']::text[]),
  ('acarbose', 'Acarbose', 'Medications', 'Longevity', array['Precose']::text[]),
  ('empagliflozin', 'Empagliflozin', 'Medications', 'Metabolic & weight', array['Jardiance', 'SGLT2 inhibitor']::text[]),
  ('canagliflozin', 'Canagliflozin', 'Medications', 'Longevity', array['Invokana', 'SGLT2 inhibitor']::text[]),
  ('dapagliflozin', 'Dapagliflozin', 'Medications', 'Metabolic & weight', array['Farxiga', 'SGLT2 inhibitor']::text[]),
  ('orforglipron', 'Orforglipron', 'Medications', 'Metabolic & weight', array['LY3502970', 'Oral GLP-1']::text[]),
  ('tesofensine', 'Tesofensine', 'Medications', 'Metabolic & weight', array['NS2330']::text[]),
  ('phentermine', 'Phentermine', 'Medications', 'Metabolic & weight', array['Adipex-P', 'Lomaira']::text[]),
  ('mk677', 'MK-677', 'Medications', 'Growth-hormone axis', array['Ibutamoren', 'MK677', 'Nutrobal']::text[]),
  ('amino1mq', '5-Amino-1MQ', 'Medications', 'Metabolic & weight', array['5-Amino-1-methylquinolinium', 'NNMT inhibitor']::text[]),
  ('slupp332', 'SLU-PP-332', 'Medications', 'Metabolic & weight', array['SLU PP 332', 'Exercise mimetic']::text[]),
  ('telmisartan', 'Telmisartan', 'Medications', 'Heart & circulation', array['Micardis']::text[]),
  ('ldn', 'Low-dose naltrexone (LDN)', 'Medications', 'Immune & inflammation', array['LDN', 'Naltrexone']::text[]),
  ('methyleneblue', 'Methylene blue', 'Medications', 'Energy & mitochondria', array['MB', 'Methylthioninium chloride', 'ProvayBlue']::text[]),
  ('anastrozole', 'Anastrozole', 'Medications', 'Hormone balance', array['Arimidex', 'Adex', 'Aromatase inhibitor', 'AI']::text[]),
  ('letrozole', 'Letrozole', 'Medications', 'Hormone balance', array['Femara']::text[]),
  ('exemestane', 'Exemestane', 'Medications', 'Hormone balance', array['Aromasin']::text[]),
  ('clomiphene', 'Clomiphene', 'Medications', 'Hormone balance', array['Clomid', 'Clomiphene citrate']::text[]),
  ('enclomiphene', 'Enclomiphene', 'Medications', 'Hormone balance', array['Androxal', 'Enclomiphene citrate']::text[]),
  ('tamoxifen', 'Tamoxifen', 'Medications', 'Hormone balance', array['Nolvadex', 'Nolva', 'Soltamox']::text[]),
  ('raloxifene', 'Raloxifene', 'Medications', 'Hormone balance', array['Evista']::text[]),
  ('cabergoline', 'Cabergoline', 'Medications', 'Hormone balance', array['Dostinex', 'Caber']::text[]),
  ('finasteride', 'Finasteride', 'Medications', 'Skin & hair', array['Propecia', 'Proscar']::text[]),
  ('dutasteride', 'Dutasteride', 'Medications', 'Skin & hair', array['Avodart']::text[]),
  ('minoxidil', 'Minoxidil', 'Medications', 'Skin & hair', array['Rogaine', 'Oral minoxidil', 'Loniten']::text[]),
  ('spironolactone', 'Spironolactone', 'Medications', 'Skin & hair', array['Aldactone', 'Spiro']::text[]),
  ('tretinoin', 'Tretinoin', 'Medications', 'Skin & hair', array['Retin-A', 'Retinoic acid']::text[]),
  ('tadalafil', 'Tadalafil', 'Medications', 'Sexual health', array['Cialis']::text[]),
  ('sildenafil', 'Sildenafil', 'Medications', 'Sexual health', array['Viagra', 'Revatio']::text[]),
  ('modafinil', 'Modafinil', 'Medications', 'Cognition & focus', array['Provigil']::text[]),
  ('armodafinil', 'Armodafinil', 'Medications', 'Cognition & focus', array['Nuvigil']::text[]),
  ('piracetam', 'Piracetam', 'Medications', 'Cognition & focus', array['Nootropil', 'Racetam']::text[]),
  ('phenylpiracetam', 'Phenylpiracetam', 'Medications', 'Cognition & focus', array['Phenotropil', 'Fonturacetam']::text[]),
  ('vita', 'Vitamin A', 'Supplements', 'Vitamins & minerals', array['Retinol', 'Retinyl palmitate']::text[]),
  ('b1', 'Vitamin B1 (thiamine)', 'Supplements', 'Vitamins & minerals', array['Thiamine']::text[]),
  ('benfotiamine', 'Benfotiamine', 'Supplements', 'Vitamins & minerals', '{}'::text[]),
  ('b2', 'Vitamin B2 (riboflavin)', 'Supplements', 'Vitamins & minerals', array['Riboflavin']::text[]),
  ('niacin', 'Niacin (vitamin B3)', 'Supplements', 'Vitamins & minerals', array['Vitamin B3', 'Nicotinic acid', 'Niacin flush']::text[]),
  ('niacinamide', 'Niacinamide', 'Supplements', 'Vitamins & minerals', array['Nicotinamide']::text[]),
  ('b5', 'Vitamin B5 (pantothenic acid)', 'Supplements', 'Vitamins & minerals', array['Pantothenic acid', 'Pantethine']::text[]),
  ('b6', 'Vitamin B6', 'Supplements', 'Vitamins & minerals', array['P5P', 'Pyridoxal 5''-phosphate', 'Pyridoxine']::text[]),
  ('biotin', 'Biotin (vitamin B7)', 'Supplements', 'Skin & hair', array['Vitamin B7', 'Vitamin H']::text[]),
  ('folate', 'Folate (methylfolate)', 'Supplements', 'Vitamins & minerals', array['Methylfolate', 'L-methylfolate', '5-MTHF', 'Folic acid', 'Vitamin B9']::text[]),
  ('b12', 'Vitamin B12', 'Supplements', 'Vitamins & minerals', array['Methylcobalamin', 'Cyanocobalamin', 'Hydroxocobalamin', 'B12 shots']::text[]),
  ('bcomplex', 'B-complex', 'Supplements', 'Vitamins & minerals', array['B vitamins', 'Vitamin B complex']::text[]),
  ('vitc', 'Vitamin C', 'Supplements', 'Vitamins & minerals', array['Ascorbic acid', 'Liposomal vitamin C', 'IV vitamin C']::text[]),
  ('vitd3', 'Vitamin D3', 'Supplements', 'Vitamins & minerals', array['Cholecalciferol', 'Vitamin D']::text[]),
  ('vite', 'Vitamin E', 'Supplements', 'Vitamins & minerals', array['Tocopherol', 'Tocotrienols']::text[]),
  ('vitk2', 'Vitamin K2', 'Supplements', 'Vitamins & minerals', array['MK-7', 'MK-4', 'Menaquinone']::text[]),
  ('multivitamin', 'Multivitamin', 'Supplements', 'Vitamins & minerals', array['Multi', 'Multivitamin and mineral']::text[]),
  ('mag', 'Magnesium glycinate', 'Supplements', 'Vitamins & minerals', array['Magnesium', 'Magnesium bisglycinate']::text[]),
  ('magthreonate', 'Magnesium L-threonate', 'Supplements', 'Cognition & focus', array['Magtein', 'Magnesium threonate']::text[]),
  ('magcitrate', 'Magnesium citrate', 'Supplements', 'Vitamins & minerals', '{}'::text[]),
  ('magmalate', 'Magnesium malate', 'Supplements', 'Vitamins & minerals', '{}'::text[]),
  ('magtaurate', 'Magnesium taurate', 'Supplements', 'Heart & circulation', '{}'::text[]),
  ('zinc', 'Zinc', 'Supplements', 'Vitamins & minerals', array['Zinc picolinate', 'Zinc bisglycinate', 'Zinc gluconate']::text[]),
  ('copper', 'Copper', 'Supplements', 'Vitamins & minerals', array['Copper bisglycinate']::text[]),
  ('selenium', 'Selenium', 'Supplements', 'Vitamins & minerals', array['Selenomethionine']::text[]),
  ('iodine', 'Iodine', 'Supplements', 'Vitamins & minerals', array['Potassium iodide', 'Kelp', 'Iodoral', 'Lugol''s']::text[]),
  ('iron', 'Iron', 'Supplements', 'Vitamins & minerals', array['Iron bisglycinate', 'Ferrous bisglycinate', 'Ferrous sulfate']::text[]),
  ('boron', 'Boron', 'Supplements', 'Hormone balance', array['Boron glycinate', 'Boron citrate']::text[]),
  ('potassium', 'Potassium', 'Supplements', 'Vitamins & minerals', array['Potassium citrate', 'Potassium chloride']::text[]),
  ('calcium', 'Calcium', 'Supplements', 'Joints & bones', array['Calcium citrate', 'Calcium carbonate']::text[]),
  ('chromium', 'Chromium picolinate', 'Supplements', 'Metabolic & weight', array['Chromium']::text[]),
  ('lithium', 'Lithium orotate', 'Supplements', 'Mood & stress', array['Low-dose lithium', 'Lithium']::text[]),
  ('electrolytes', 'Electrolytes', 'Supplements', 'Muscle & performance', array['LMNT', 'Liquid I.V.', 'Hydration mix', 'Sodium', 'Salt']::text[]),
  ('creatine', 'Creatine monohydrate', 'Supplements', 'Muscle & performance', array['Creatine', 'Creatine HCl']::text[]),
  ('glycine', 'Glycine', 'Supplements', 'Sleep', '{}'::text[]),
  ('taurine', 'Taurine', 'Supplements', 'Longevity', '{}'::text[]),
  ('ltheanine', 'L-theanine', 'Supplements', 'Mood & stress', array['Theanine', 'Suntheanine']::text[]),
  ('ltyrosine', 'L-tyrosine', 'Supplements', 'Cognition & focus', array['Tyrosine', 'NALT', 'N-acetyl L-tyrosine']::text[]),
  ('nac', 'NAC (N-acetylcysteine)', 'Supplements', 'Liver & detox', array['N-acetyl cysteine', 'N-acetyl-L-cysteine', 'NAC']::text[]),
  ('lcarnitine', 'L-carnitine', 'Supplements', 'Metabolic & weight', array['Carnitine', 'L-carnitine tartrate', 'LCLT', 'Carnitine injections']::text[]),
  ('alcar', 'Acetyl-L-carnitine (ALCAR)', 'Supplements', 'Cognition & focus', array['ALCAR', 'ALC', 'Acetyl L-carnitine']::text[]),
  ('larginine', 'L-arginine', 'Supplements', 'Heart & circulation', array['Arginine', 'AAKG']::text[]),
  ('lcitrulline', 'L-citrulline', 'Supplements', 'Heart & circulation', array['Citrulline', 'Citrulline malate']::text[]),
  ('glutamine', 'L-glutamine', 'Supplements', 'Gut & digestion', array['Glutamine']::text[]),
  ('betaalanine', 'Beta-alanine', 'Supplements', 'Muscle & performance', array['Carnosyn']::text[]),
  ('bcaa', 'BCAAs', 'Supplements', 'Muscle & performance', array['Branched-chain amino acids', 'Leucine', 'Isoleucine', 'Valine']::text[]),
  ('eaa', 'EAAs', 'Supplements', 'Muscle & performance', array['Essential amino acids']::text[]),
  ('hmb', 'HMB', 'Supplements', 'Muscle & performance', array['Beta-hydroxy beta-methylbutyrate', 'HMB-FA']::text[]),
  ('whey', 'Whey protein', 'Supplements', 'Muscle & performance', array['Whey', 'Protein powder', 'Whey isolate']::text[]),
  ('llysine', 'L-lysine', 'Supplements', 'Immune & inflammation', array['Lysine']::text[]),
  ('tryptophan', 'L-tryptophan', 'Supplements', 'Mood & stress', array['Tryptophan']::text[]),
  ('5htp', '5-HTP', 'Supplements', 'Mood & stress', array['5-hydroxytryptophan', 'Griffonia']::text[]),
  ('gaba', 'GABA', 'Supplements', 'Mood & stress', array['Gamma-aminobutyric acid', 'PharmaGABA']::text[]),
  ('carnosine', 'Carnosine', 'Supplements', 'Longevity', array['L-carnosine']::text[]),
  ('tmg', 'TMG (betaine)', 'Supplements', 'Longevity', array['Trimethylglycine', 'Betaine anhydrous', 'Betaine']::text[]),
  ('same', 'SAMe', 'Supplements', 'Mood & stress', array['S-adenosylmethionine']::text[]),
  ('agmatine', 'Agmatine', 'Supplements', 'Mood & stress', array['Agmatine sulfate']::text[]),
  ('daa', 'D-aspartic acid', 'Supplements', 'Hormone balance', array['DAA']::text[]),
  ('nad', 'NAD+', 'Supplements', 'Energy & mitochondria', array['NAD', 'Nicotinamide adenine dinucleotide', 'NAD+ injections', 'NAD IV']::text[]),
  ('nmn', 'NMN', 'Supplements', 'Longevity', array['Nicotinamide mononucleotide']::text[]),
  ('nr', 'NR (nicotinamide riboside)', 'Supplements', 'Longevity', array['Nicotinamide riboside', 'Niagen', 'Tru Niagen']::text[]),
  ('resveratrol', 'Resveratrol', 'Supplements', 'Longevity', array['Trans-resveratrol']::text[]),
  ('pterostilbene', 'Pterostilbene', 'Supplements', 'Longevity', '{}'::text[]),
  ('fisetin', 'Fisetin', 'Supplements', 'Longevity', array['Senolytic']::text[]),
  ('quercetin', 'Quercetin', 'Supplements', 'Longevity', array['Quercetin phytosome', 'Senolytic']::text[]),
  ('spermidine', 'Spermidine', 'Supplements', 'Longevity', array['spermidineLIFE', 'Wheat germ extract']::text[]),
  ('urolithina', 'Urolithin A', 'Supplements', 'Longevity', array['Mitopure', 'Timeline']::text[]),
  ('akg', 'Calcium AKG', 'Supplements', 'Longevity', array['Alpha-ketoglutarate', 'Ca-AKG', 'AKG', 'Rejuvant']::text[]),
  ('coq10', 'CoQ10', 'Supplements', 'Energy & mitochondria', array['Coenzyme Q10', 'Ubiquinone', 'Ubiquinol']::text[]),
  ('pqq', 'PQQ', 'Supplements', 'Energy & mitochondria', array['Pyrroloquinoline quinone']::text[]),
  ('ala', 'Alpha-lipoic acid', 'Supplements', 'Metabolic & weight', array['ALA', 'R-ALA', 'R-lipoic acid']::text[]),
  ('sulforaphane', 'Sulforaphane', 'Supplements', 'Longevity', array['Broccoli sprout extract', 'Avmacol']::text[]),
  ('ketones', 'Ketones (BHB)', 'Supplements', 'Energy & mitochondria', array['Exogenous ketones', 'Beta-hydroxybutyrate', 'Ketone ester', 'Ketone salts']::text[]),
  ('mct', 'MCT oil', 'Supplements', 'Energy & mitochondria', array['Medium-chain triglycerides', 'C8']::text[]),
  ('dribose', 'D-ribose', 'Supplements', 'Energy & mitochondria', array['Ribose']::text[]),
  ('shilajit', 'Shilajit', 'Supplements', 'Energy & mitochondria', array['PrimaVie', 'Mumijo', 'Fulvic acid']::text[]),
  ('cordyceps', 'Cordyceps', 'Supplements', 'Energy & mitochondria', array['Cordyceps militaris', 'CS-4']::text[]),
  ('caffeine', 'Caffeine', 'Supplements', 'Cognition & focus', '{}'::text[]),
  ('theacrine', 'Theacrine', 'Supplements', 'Cognition & focus', array['TeaCrine']::text[]),
  ('alphagpc', 'Alpha-GPC', 'Supplements', 'Cognition & focus', array['Choline alfoscerate', 'A-GPC']::text[]),
  ('citicoline', 'Citicoline (CDP-choline)', 'Supplements', 'Cognition & focus', array['CDP-choline', 'Cognizin']::text[]),
  ('huperzine', 'Huperzine A', 'Supplements', 'Cognition & focus', array['Hup A']::text[]),
  ('bacopa', 'Bacopa monnieri', 'Supplements', 'Cognition & focus', array['Brahmi', 'Bacognize', 'Synapsa']::text[]),
  ('lions', 'Lion’s mane', 'Supplements', 'Cognition & focus', array['Lion''s mane', 'Hericium erinaceus']::text[]),
  ('ginkgo', 'Ginkgo biloba', 'Supplements', 'Cognition & focus', array['Ginkgo']::text[]),
  ('ps', 'Phosphatidylserine', 'Supplements', 'Cognition & focus', array['PS']::text[]),
  ('uridine', 'Uridine monophosphate', 'Supplements', 'Cognition & focus', array['UMP', 'Uridine']::text[]),
  ('noopept', 'Noopept', 'Supplements', 'Cognition & focus', array['Omberacetam', 'GVS-111']::text[]),
  ('sulbutiamine', 'Sulbutiamine', 'Supplements', 'Cognition & focus', array['Arcalion']::text[]),
  ('saffron', 'Saffron extract', 'Supplements', 'Mood & stress', array['Affron', 'Crocus sativus', 'Saffron']::text[]),
  ('ashwagandha', 'Ashwagandha', 'Supplements', 'Mood & stress', array['KSM-66', 'Sensoril', 'Withania somnifera']::text[]),
  ('rhodiola', 'Rhodiola rosea', 'Supplements', 'Mood & stress', array['Rhodiola', 'Golden root']::text[]),
  ('holybasil', 'Holy basil', 'Supplements', 'Mood & stress', array['Tulsi']::text[]),
  ('ginseng', 'Panax ginseng', 'Supplements', 'Energy & mitochondria', array['Korean red ginseng', 'Ginseng']::text[]),
  ('eleuthero', 'Eleuthero', 'Supplements', 'Energy & mitochondria', array['Siberian ginseng']::text[]),
  ('schisandra', 'Schisandra', 'Supplements', 'Mood & stress', array['Schisandra chinensis']::text[]),
  ('kava', 'Kava', 'Supplements', 'Mood & stress', array['Kavalactones']::text[]),
  ('magnolia', 'Magnolia bark', 'Supplements', 'Sleep', array['Honokiol', 'Relora']::text[]),
  ('stjohns', 'St. John’s wort', 'Supplements', 'Mood & stress', array['St. John''s wort', 'Hypericum']::text[]),
  ('mucuna', 'Mucuna pruriens', 'Supplements', 'Mood & stress', array['L-DOPA', 'Velvet bean']::text[]),
  ('melatonin', 'Melatonin', 'Supplements', 'Sleep', '{}'::text[]),
  ('apigenin', 'Apigenin', 'Supplements', 'Sleep', array['Chamomile extract']::text[]),
  ('valerian', 'Valerian root', 'Supplements', 'Sleep', array['Valerian']::text[]),
  ('lemonbalm', 'Lemon balm', 'Supplements', 'Sleep', array['Melissa officinalis']::text[]),
  ('tartcherry', 'Tart cherry', 'Supplements', 'Sleep', array['Montmorency cherry']::text[]),
  ('tongkatali', 'Tongkat ali', 'Supplements', 'Hormone balance', array['Longjack', 'Eurycoma longifolia', 'LJ100']::text[]),
  ('fadogia', 'Fadogia agrestis', 'Supplements', 'Hormone balance', array['Fadogia']::text[]),
  ('maca', 'Maca', 'Supplements', 'Sexual health', array['Lepidium meyenii']::text[]),
  ('tribulus', 'Tribulus terrestris', 'Supplements', 'Hormone balance', array['Tribulus']::text[]),
  ('dim', 'DIM', 'Supplements', 'Hormone balance', array['Diindolylmethane']::text[]),
  ('calciumdglucarate', 'Calcium D-glucarate', 'Supplements', 'Liver & detox', '{}'::text[]),
  ('sawpalmetto', 'Saw palmetto', 'Supplements', 'Hormone balance', array['Serenoa repens']::text[]),
  ('nettleroot', 'Stinging nettle root', 'Supplements', 'Hormone balance', array['Urtica dioica', 'Nettle root']::text[]),
  ('fenugreek', 'Fenugreek', 'Supplements', 'Hormone balance', array['Testofen']::text[]),
  ('vitex', 'Vitex (chasteberry)', 'Supplements', 'Hormone balance', array['Chasteberry', 'Vitex agnus-castus']::text[]),
  ('inositol', 'Myo-inositol', 'Supplements', 'Hormone balance', array['Inositol', 'Ovasitol', 'D-chiro-inositol']::text[]),
  ('7ketodhea', '7-Keto DHEA', 'Supplements', 'Metabolic & weight', array['7-oxo-DHEA']::text[]),
  ('hornygoatweed', 'Horny goat weed', 'Supplements', 'Sexual health', array['Epimedium', 'Icariin']::text[]),
  ('yohimbine', 'Yohimbine', 'Supplements', 'Metabolic & weight', array['Yohimbe']::text[]),
  ('berberine', 'Berberine', 'Supplements', 'Metabolic & weight', array['Dihydroberberine', 'GlucoVantage']::text[]),
  ('egcg', 'Green tea extract (EGCG)', 'Supplements', 'Metabolic & weight', array['EGCG', 'Green tea']::text[]),
  ('psyllium', 'Psyllium husk', 'Supplements', 'Gut & digestion', array['Metamucil', 'Fiber']::text[]),
  ('omega3', 'Omega-3 fish oil', 'Supplements', 'Heart & circulation', array['Fish oil', 'Omega-3', 'EPA', 'DHA', 'Krill oil', 'Algae oil']::text[]),
  ('nattokinase', 'Nattokinase', 'Supplements', 'Heart & circulation', '{}'::text[]),
  ('garlic', 'Aged garlic extract', 'Supplements', 'Heart & circulation', array['Garlic', 'Kyolic']::text[]),
  ('beetroot', 'Beetroot (nitrates)', 'Supplements', 'Heart & circulation', array['Beet juice', 'Dietary nitrate', 'Nitrates']::text[]),
  ('redyeastrice', 'Red yeast rice', 'Supplements', 'Heart & circulation', array['Monacolin K']::text[]),
  ('bergamot', 'Citrus bergamot', 'Supplements', 'Heart & circulation', array['Bergamot']::text[]),
  ('probiotic', 'Probiotics', 'Supplements', 'Gut & digestion', array['Probiotic', 'Lactobacillus', 'Bifidobacterium']::text[]),
  ('sboulardii', 'Saccharomyces boulardii', 'Supplements', 'Gut & digestion', array['S. boulardii', 'Florastor']::text[]),
  ('prebiotic', 'Prebiotic fiber', 'Supplements', 'Gut & digestion', array['Inulin', 'PHGG', 'Partially hydrolyzed guar gum', 'GOS']::text[]),
  ('colostrum', 'Colostrum', 'Supplements', 'Gut & digestion', array['Bovine colostrum']::text[]),
  ('zinccarnosine', 'Zinc carnosine', 'Supplements', 'Gut & digestion', array['PepZinGI', 'Polaprezinc']::text[]),
  ('butyrate', 'Butyrate', 'Supplements', 'Gut & digestion', array['Sodium butyrate', 'Tributyrin']::text[]),
  ('enzymes', 'Digestive enzymes', 'Supplements', 'Gut & digestion', array['Enzymes']::text[]),
  ('betainehcl', 'Betaine HCl', 'Supplements', 'Gut & digestion', array['Betaine hydrochloride']::text[]),
  ('curcumin', 'Curcumin', 'Supplements', 'Immune & inflammation', array['Turmeric', 'Meriva', 'Longvida', 'BCM-95']::text[]),
  ('boswellia', 'Boswellia', 'Supplements', 'Immune & inflammation', array['Boswellia serrata', 'AKBA', '5-Loxin']::text[]),
  ('pea', 'PEA (palmitoylethanolamide)', 'Supplements', 'Immune & inflammation', array['Palmitoylethanolamide', 'Levagen']::text[]),
  ('blackseed', 'Black seed oil', 'Supplements', 'Immune & inflammation', array['Nigella sativa', 'Thymoquinone']::text[]),
  ('elderberry', 'Elderberry', 'Supplements', 'Immune & inflammation', array['Sambucus']::text[]),
  ('reishi', 'Reishi', 'Supplements', 'Immune & inflammation', array['Ganoderma lucidum']::text[]),
  ('turkeytail', 'Turkey tail', 'Supplements', 'Immune & inflammation', array['Trametes versicolor', 'PSK']::text[]),
  ('tudca', 'TUDCA', 'Supplements', 'Liver & detox', array['Tauroursodeoxycholic acid']::text[]),
  ('milkthistle', 'Milk thistle', 'Supplements', 'Liver & detox', array['Silymarin']::text[]),
  ('glucosamine', 'Glucosamine', 'Supplements', 'Joints & bones', array['Glucosamine sulfate']::text[]),
  ('chondroitin', 'Chondroitin', 'Supplements', 'Joints & bones', '{}'::text[]),
  ('msm', 'MSM', 'Supplements', 'Joints & bones', array['Methylsulfonylmethane']::text[]),
  ('uc2', 'Type II collagen (UC-II)', 'Supplements', 'Joints & bones', array['UC-II', 'Undenatured type II collagen']::text[]),
  ('collagen', 'Collagen peptides', 'Supplements', 'Skin & hair', array['Collagen', 'Hydrolyzed collagen']::text[]),
  ('hyaluronic', 'Hyaluronic acid', 'Supplements', 'Skin & hair', array['HA']::text[]),
  ('astaxanthin', 'Astaxanthin', 'Supplements', 'Skin & hair', '{}'::text[]),
  ('sodiumbicarb', 'Sodium bicarbonate', 'Supplements', 'Muscle & performance', array['Baking soda']::text[]),
  ('ecdysterone', 'Ecdysterone', 'Supplements', 'Muscle & performance', array['Beta-ecdysterone', '20-hydroxyecdysone']::text[]),
  ('turkesterone', 'Turkesterone', 'Supplements', 'Muscle & performance', array['Ajuga turkestanica']::text[]),
  ('epicatechin', 'Epicatechin', 'Supplements', 'Muscle & performance', array['(-)-Epicatechin']::text[]),
  ('cjcipa', 'CJC-1295 / Ipamorelin blend', 'Blends', 'Growth-hormone axis', array['CJC/Ipa', 'CJC Ipa', 'Ipa/CJC', 'Mod GRF/Ipamorelin']::text[]),
  ('tesaipa', 'Tesamorelin / Ipamorelin blend', 'Blends', 'Growth-hormone axis', array['Tesa/Ipa']::text[]),
  ('wolverine', 'Wolverine blend (BPC-157 + TB-500)', 'Blends', 'Healing & recovery', array['Wolverine', 'Wolverine stack', 'BPC/TB', 'BPC-157/TB-500']::text[]),
  ('glow', 'GLOW blend (GHK-Cu, BPC-157, TB-500)', 'Blends', 'Skin & hair', array['GLOW', 'Glow blend']::text[]),
  ('klow', 'KLOW blend (GHK-Cu, BPC-157, TB-500, KPV)', 'Blends', 'Skin & hair', array['KLOW', 'Klow blend']::text[]),
  ('semaxselank', 'Semax / Selank blend', 'Blends', 'Cognition & focus', array['Semax/Selank']::text[]),
  ('cagrisema', 'CagriSema (cagrilintide + semaglutide)', 'Blends', 'Metabolic & weight', array['CagriSema']::text[]),
  ('biest', 'Biest (estriol + estradiol)', 'Blends', 'Hormone balance', array['Bi-est']::text[]),
  ('lipoc', 'Lipo-C / MIC injections', 'Blends', 'Metabolic & weight', array['MIC', 'Lipo-B', 'Lipotropic injections', 'Methionine inositol choline']::text[])
on conflict (id) do update
  set name = excluded.name, family = excluded.family,
      category = excluded.category, aliases = excluded.aliases;

update public.compounds set kind = 'blend' where family = 'Blends';
insert into public.compound_parts (compound_id, part_id) values
  ('cjcipa', 'modgrf129'),
  ('cjcipa', 'ipamorelin'),
  ('tesaipa', 'tesamorelin'),
  ('tesaipa', 'ipamorelin'),
  ('wolverine', 'bpc157'),
  ('wolverine', 'tb500'),
  ('glow', 'ghkcu'),
  ('glow', 'bpc157'),
  ('glow', 'tb500'),
  ('klow', 'ghkcu'),
  ('klow', 'bpc157'),
  ('klow', 'tb500'),
  ('klow', 'kpv'),
  ('semaxselank', 'semax'),
  ('semaxselank', 'selank'),
  ('cagrisema', 'cagrilintide'),
  ('cagrisema', 'semaglutide'),
  ('biest', 'estriol'),
  ('biest', 'estradiol')
on conflict do nothing;

-- Two entries with the same name would make search ambiguous
create unique index compounds_name_unique on public.compounds (lower(name));

-- ---------------------------------------------------------------------------
-- What's in each post: the compound, blend or stack it's in, and their parts
-- ---------------------------------------------------------------------------
alter table public.posts add column part_ids text[] not null default '{}';
create index posts_part_ids_idx on public.posts using gin (part_ids);

-- The entry itself, what's in it, and what's in any blend inside a stack
create function private.parts_of(p_compound text) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array[p_compound]
         || array(select distinct x from (
                    select cp.part_id as x from public.compound_parts cp where cp.compound_id = p_compound
                    union
                    select inner_cp.part_id from public.compound_parts cp
                    join public.compound_parts inner_cp on inner_cp.compound_id = cp.part_id
                    where cp.compound_id = p_compound) parts
                  where x <> p_compound order by x)
$$;

create function private.posts_set_parts() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.part_ids := private.parts_of(new.compound_id);
  return new;
end;
$$;

create trigger posts_set_parts before insert or update of compound_id on public.posts
  for each row execute function private.posts_set_parts();

update public.posts set part_ids = private.parts_of(compound_id);

-- ---------------------------------------------------------------------------
-- Stacks: found or made from the compounds a member picks
-- ---------------------------------------------------------------------------
-- One pick is that compound (or blend). Two to eight picks are the stack of
-- exactly those, made the first time anyone posts it. Picks come from the
-- library; a stack can't contain another stack.
create function private.stack_for(p_ids text[]) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids text[];
  v_n integer;
  v_known integer;
  v_key text;
  v_id text;
  v_name text;
begin
  if v_uid is null or not private.can_write() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids
  from (select lower(btrim(t.x)) as x from unnest(coalesce(p_ids, '{}')) as t(x)) s
  where x <> '';
  v_n := cardinality(v_ids);
  if v_n = 0 then
    raise exception 'Pick what you took from the library.' using errcode = 'P0001';
  end if;
  if v_n > 8 then
    raise exception 'A stack can have up to 8 compounds.' using errcode = 'P0001';
  end if;
  select count(*) into v_known from public.compounds c
  where c.id = any (v_ids) and c.kind in ('compound', 'blend');
  if v_known <> v_n then
    raise exception 'Pick compounds from the library. If one is missing, suggest it.' using errcode = 'P0001';
  end if;
  if v_n = 1 then
    return v_ids[1];
  end if;

  v_key := array_to_string(v_ids, '+');
  -- Two members posting the same new stack at once get the same space
  perform pg_advisory_xact_lock(hashtext('stack:' || v_key));
  select c.id into v_id from public.compounds c where c.stack_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  v_id := 'stack-' || substr(md5(v_key), 1, 12);
  select string_agg(c.name, ' + ' order by lower(c.name)) into v_name
  from public.compounds c where c.id = any (v_ids);
  insert into public.compounds (id, name, kind, family, category, aliases, stack_key, created_by)
  values (v_id, v_name, 'stack', 'Stacks', 'Stacks', '{}', v_key, v_uid);
  insert into public.compound_parts (compound_id, part_id)
  select v_id, x from unnest(v_ids) as t(x);
  return v_id;
end;
$$;

-- Starting a post with one or more compounds. Runs as the member, so the usual
-- limits, checks and access rules apply; if the post is refused, no stack is made.
create function public.create_post(compounds text[], kind public.post_kind, title text, body text)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.posts (compound_id, kind, title, body)
  values (private.stack_for(create_post.compounds), coalesce(create_post.kind, 'experience'),
          create_post.title, create_post.body)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suggestions for the library
-- ---------------------------------------------------------------------------
insert into private.settings (key, value, note) values
  ('library_requests_per_day', '10', 'Library suggestions a member can send in 24 hours')
on conflict (key) do nothing;

create table public.compound_requests (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  note text check (char_length(note) <= 300),
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'added', 'dismissed')),
  compound_id text references public.compounds (id) on delete set null,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index compound_requests_open_idx on public.compound_requests (created_at) where status = 'open';
create index compound_requests_requested_by_idx on public.compound_requests (requested_by, created_at desc);
create index compound_requests_resolved_by_idx on public.compound_requests (resolved_by);
create index compound_requests_compound_idx on public.compound_requests (compound_id);

create function private.compound_requests_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_check record;
begin
  if v_uid is null then
    return new;  -- the database owner or the service role
  end if;
  new.requested_by := v_uid;
  new.name := btrim(new.name);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.status := 'open';
  new.compound_id := null;
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at := now();
  select count(*) into v_count from public.compound_requests
  where requested_by = v_uid and created_at > now() - interval '24 hours';
  if v_count >= private.setting_int('library_requests_per_day') then
    raise exception 'That''s a lot of suggestions for one day. Try again tomorrow.'
      using errcode = 'P0001', hint = 'rate_limit';
  end if;
  select * into v_check from private.check_text(new.name || E'\n' || coalesce(new.note, ''), private.is_new_member(v_uid));
  if v_check.verdict = 'block' then
    raise exception '%', v_check.message using errcode = 'P0001', hint = 'blocked_' || v_check.reason;
  end if;
  if exists (select 1 from public.compounds c
             where c.kind <> 'stack'
               and (lower(c.name) = lower(new.name)
                    or exists (select 1 from unnest(c.aliases) a where lower(a) = lower(new.name)))) then
    raise exception '% is already in the library.', new.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger compound_requests_before_insert before insert on public.compound_requests
  for each row execute function private.compound_requests_before_insert();

-- Notes in the bell: "added to the library, as you suggested"
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('welcome', 'comment', 'reply', 'same_for_me', 'counted',
                  'milestone', 'level_up', 'badge', 'mod', 'library'));

create function private.add_compound(
  p_name text, p_family text, p_category text, p_aliases text[], p_request bigint
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_base text;
  v_id text;
  v_n integer := 1;
  v_req public.compound_requests;
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can add to the library.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Give it a name of 2 to 80 characters.' using errcode = 'P0001';
  end if;
  if p_family is null or p_family not in ('Peptides', 'Hormones', 'Supplements', 'Medications', 'Blends') then
    raise exception 'Pick a family: peptides, hormones, supplements, medications or blends.' using errcode = 'P0001';
  end if;
  if v_category not in ('Metabolic & weight', 'Growth-hormone axis', 'Healing & recovery', 'Gut & digestion',
                        'Immune & inflammation', 'Cognition & focus', 'Mood & stress', 'Sleep', 'Sexual health',
                        'Skin & hair', 'Longevity', 'Hormone balance', 'Muscle & performance', 'Heart & circulation',
                        'Energy & mitochondria', 'Vitamins & minerals', 'Liver & detox', 'Joints & bones') then
    raise exception 'Pick a category from the list.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.compounds c where lower(c.name) = lower(v_name)) then
    raise exception '% is already in the library.', v_name using errcode = 'P0001';
  end if;
  -- An id from the name: lowercase letters, digits and dashes
  v_base := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 34);
  if char_length(v_base) < 2 then
    v_base := 'compound';
  end if;
  if v_base like 'stack-%' then
    v_base := 'c-' || left(v_base, 32);
  end if;
  v_id := v_base;
  while exists (select 1 from public.compounds c where c.id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;
  insert into public.compounds (id, name, kind, family, category, aliases)
  values (v_id, v_name, case when p_family = 'Blends' then 'blend' else 'compound' end, p_family, v_category,
          coalesce((select array_agg(distinct left(btrim(a), 60)) from unnest(coalesce(p_aliases, '{}')) as t(a)
                    where btrim(a) <> ''), '{}'));
  if p_request is not null then
    update public.compound_requests
       set status = 'added', compound_id = v_id, resolved_by = v_uid, resolved_at = now()
     where id = p_request and status = 'open'
    returning * into v_req;
    if v_req.requested_by is not null then
      perform private.notify(v_req.requested_by, 'library', null, null, v_id,
                             jsonb_build_object('name', v_name), 'library:' || v_req.id);
    end if;
  end if;
  return v_id;
end;
$$;

create function private.dismiss_compound_request(p_request bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can do that.' using errcode = '42501';
  end if;
  update public.compound_requests
     set status = 'dismissed', resolved_by = (select auth.uid()), resolved_at = now()
   where id = p_request and status = 'open';
end;
$$;

create function public.add_compound(name text, family text, category text, aliases text[], request_id bigint default null)
returns text
language sql security invoker set search_path = ''
as $$ select private.add_compound(name, family, category, aliases, request_id) $$;

create function public.dismiss_compound_request(request_id bigint) returns void
language sql security invoker set search_path = ''
as $$ select private.dismiss_compound_request(request_id) $$;

-- ---------------------------------------------------------------------------
-- Community goals: only for compounds someone has reported on, or that start
-- from a public-forum baseline (300 empty "unlock" goals would just be noise)
-- ---------------------------------------------------------------------------
create or replace function private.community_goals()
returns table (compound_id text, compound_name text, kind text, have integer, need integer)
language sql stable security definer set search_path = ''
as $$
  with counted as (
    select r.compound_id, count(*)::integer as n
    from public.post_reads r join public.posts p on p.id = r.post_id
    where r.counts and p.status = 'visible'
    group by r.compound_id
  ), latest as (
    select distinct on (s.compound_id) s.compound_id, s.score, s.internal_share
    from public.signal_snapshots s order by s.compound_id, s.version desc
  )
  select c.id, c.name,
         case when b.compound_id is null and l.score is null then 'unlock' else 'takeover' end,
         case when b.compound_id is null and l.score is null then coalesce(k.n, 0) else coalesce(l.internal_share, 0)::integer end,
         case when b.compound_id is null and l.score is null then private.setting_int('signal_min_reports') else 50 end
  from public.compounds c
  left join public.signal_baseline b on b.compound_id = c.id
  left join latest l on l.compound_id = c.id
  left join counted k on k.compound_id = c.id
  where (select private.can_read())
    and (b.compound_id is not null or l.compound_id is not null or coalesce(k.n, 0) > 0)
$$;

-- ---------------------------------------------------------------------------
-- What members read
-- ---------------------------------------------------------------------------
-- Spaces gain the family, aliases and parts. A stack shows once it has a post.
create or replace view public.spaces with (security_invoker = true) as
select c.id as compound_id, c.name, c.category, c.members_count,
       exists (select 1 from public.space_members m
               where m.compound_id = c.id and m.user_id = (select auth.uid())) as joined,
       (select count(*) from public.posts p
        where p.compound_id = c.id and p.status = 'visible' and p.created_at > now() - interval '7 days') as posts_week,
       (select count(*) from public.post_reads r join public.posts p on p.id = r.post_id
        where r.compound_id = c.id and r.counts and p.status = 'visible') as reports,
       b.score, b.prev_score, b.internal_share, b.first_hand, b.same_for_me, b.summary_label, b.confidence_label,
       c.kind, c.family, c.aliases,
       coalesce((select array_agg(cp.part_id order by cp.part_id)
                 from public.compound_parts cp where cp.compound_id = c.id), '{}') as part_ids
from public.compounds c
left join public.signal_board b on b.compound_id = c.id
where c.kind <> 'stack' or exists (select 1 from public.posts p where p.compound_id = c.id);

-- The feed gains what's in each post; your spaces include stacks with a compound you follow
create or replace view public.feed with (security_invoker = true) as
select p.id, p.compound_id, c.name as compound_name, c.category as compound_category,
       p.kind, p.title, p.body, p.status, p.status_reason, p.score,
       p.created_at, p.edited_at, p.author_id, a.handle as author_handle,
       (p.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.post_votes v
        where v.post_id = p.id and v.user_id = (select auth.uid())) as my_vote,
       (select count(*) from public.comments cm
        where cm.post_id = p.id and cm.status = 'visible') as comment_count,
       coalesce(r.counts, false) and p.status = 'visible' as counts_for_signal,
       r.outcome, r.duration, coalesce(r.side_effects, '{}') as side_effects,
       p.same_count,
       exists (select 1 from public.same_for_me s
               where s.post_id = p.id and s.user_id = (select auth.uid())) as i_same,
       (r.post_id is null and p.kind = 'experience' and p.status = 'visible'
        and p.created_at > now() - interval '10 minutes') as read_pending,
       p.reactions,
       coalesce((select array_agg(x.sticker order by x.sticker) from public.post_reactions x
                 where x.post_id = p.id and x.user_id = (select auth.uid())), '{}') as my_reactions,
       coalesce(ms.level, 1) as author_level,
       r.confirmed_at is not null as read_confirmed,
       coalesce(r.corrected, false) as read_corrected,
       round((sign(p.score + p.same_count)::numeric * log(greatest(abs(p.score + p.same_count), 1)::numeric)
              + extract(epoch from p.created_at) / 45000)::numeric, 6) as hot,
       exists (select 1 from public.space_members m
               where m.user_id = (select auth.uid())
                 and (m.compound_id = p.compound_id or m.compound_id = any (p.part_ids))) as in_my_spaces,
       p.part_ids, c.kind as compound_kind
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id
left join public.member_scores ms on ms.user_id = p.author_id;

-- The board gains the kind and family, so the app can show stacks apart
create or replace view public.signal_board with (security_invoker = true) as
with ranked as (
  select s.*, row_number() over (partition by s.compound_id order by s.version desc) as rn
  from public.signal_snapshots s
)
select c.id as compound_id, c.name as compound_name, c.category,
       cur.score, prev.score as prev_score,
       cur.efficacy, cur.consistency, cur.diversity, cur.confidence,
       case when cur.confidence >= 80 then 'High' when cur.confidence >= 60 then 'Moderate'
            when cur.confidence >= 40 then 'Building' else 'Low' end as confidence_label,
       case when cur.efficacy >= 75 then 'Mostly positive' when cur.efficacy >= 60 then 'Leaning positive'
            when cur.efficacy >= 45 then 'Mixed' else 'Mostly negative' end as summary_label,
       cur.first_hand, cur.same_for_me, cur.voices, cur.internal_share,
       cur.themes, cur.source_families, cur.version, cur.computed_at,
       c.kind, c.family
from ranked cur
join public.compounds c on c.id = cur.compound_id
left join ranked prev on prev.compound_id = cur.compound_id and prev.rn = 2
where cur.rn = 1;

create view public.library_requests with (security_invoker = true) as
select r.id, r.name, r.note, r.status, r.compound_id, r.created_at, r.resolved_at,
       a.handle as requested_by_handle, (r.requested_by = (select auth.uid())) as is_mine
from public.compound_requests r
left join public.profiles a on a.id = r.requested_by;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke all on public.compound_parts, public.compound_requests, public.library_requests from anon, authenticated;
revoke execute on function public.create_post(text[], public.post_kind, text, text) from public, anon;
revoke execute on function public.add_compound(text, text, text, text[], bigint) from public, anon;
revoke execute on function public.dismiss_compound_request(bigint) from public, anon;
revoke execute on function private.stack_for(text[]) from public, anon;
revoke execute on function private.add_compound(text, text, text, text[], bigint) from public, anon;
revoke execute on function private.dismiss_compound_request(bigint) from public, anon;
revoke execute on function private.parts_of(text) from public, anon, authenticated;
revoke execute on function private.posts_set_parts() from public, anon, authenticated;
revoke execute on function private.compound_requests_before_insert() from public, anon, authenticated;

grant select on public.compound_parts to authenticated;
grant select on public.compound_requests to authenticated;
grant insert (name, note) on public.compound_requests to authenticated;
grant select on public.library_requests to authenticated;
grant select on public.spaces, public.feed, public.signal_board to authenticated;
grant execute on function public.create_post(text[], public.post_kind, text, text) to authenticated;
grant execute on function public.add_compound(text, text, text, text[], bigint) to authenticated;
grant execute on function public.dismiss_compound_request(bigint) to authenticated;
grant execute on function private.stack_for(text[]) to authenticated;
grant execute on function private.add_compound(text, text, text, text[], bigint) to authenticated;
grant execute on function private.dismiss_compound_request(bigint) to authenticated;

alter table public.compound_parts enable row level security;
alter table public.compound_requests enable row level security;

create policy "members read what blends and stacks contain" on public.compound_parts
  for select to authenticated using ((select private.can_read()));

create policy "read own suggestions" on public.compound_requests
  for select to authenticated
  using (requested_by = (select auth.uid()) or (select private.is_moderator()));
create policy "suggest for the library" on public.compound_requests
  for insert to authenticated
  with check (requested_by = (select auth.uid()) and (select private.can_write()));
