p = 'd:/PGCS-21/App/PGCS-21/index.html'
t = open(p, encoding='utf-8').read()
reps = [
    ('Data Entry Form নিয়ন্ত্রণ', 'Data Entry Form Control'),
    ('সদস্য ও Login (Username = MID)', 'Members & Login (Username = MID)'),
    ('+ নতুন সদস্য', '+ New Member'),
]
for a, b in reps:
    if a in t:
        t = t.replace(a, b)
        print('replaced index.html:', a[:35])
    else:
        print('not found index.html:', a[:35])
open(p, 'w', encoding='utf-8').write(t)
