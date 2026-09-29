# -*- coding: utf-8 -*-
"""Read the Vietnam plant equipment xlsx and emit src/content/equipment.json (ZH/EN/VI)."""
import json, re, sys, collections
import pandas as pd

CAT = {
 "射出成型機":    ("Injection Molding Machines",       "Máy ép nhựa"),
 "射出周邊設備":  ("Injection Ancillary Equipment",    "Thiết bị phụ trợ ép nhựa"),
 "組裝與二次加工": ("Assembly & Secondary Processing",  "Lắp ráp & gia công thứ cấp"),
 "包裝設備":      ("Packaging Equipment",              "Thiết bị đóng gói"),
 "品保檢測設備":  ("Quality Testing Equipment",        "Thiết bị kiểm tra chất lượng"),
 "精密量具":      ("Precision Measuring Instruments",  "Dụng cụ đo chính xác"),
}

LOC = {
 "一廠 射出成型區": ("Plant 1 — Molding",  "Nhà máy 1 — Khu ép"),
 "二廠 射出成型區": ("Plant 2 — Molding",  "Nhà máy 2 — Khu ép"),
 "組裝車間":       ("Assembly shop",      "Xưởng lắp ráp"),
 "品保實驗室":     ("QA laboratory",      "Phòng thí nghiệm QA"),
 "品保部":         ("QA department",      "Bộ phận QA"),
 "移印車間":       ("Pad printing shop",  "Xưởng in pad"),
 "樣品室":         ("Sample room",        "Phòng mẫu"),
 "模具區":         ("Mold area",          "Khu khuôn"),
}

NAME = {
 "立式射出成型機": ("Vertical injection machine","Máy ép nhựa đứng"),
 "臥式射出成型機（海天 HAITIAN）": ("Horizontal injection machine (Haitian)","Máy ép nhựa ngang (Haitian)"),
 "伺服油壓射出成型機（台中精機 VICTOR）": ("Servo-hydraulic injection machine (Victor)","Máy ép nhựa servo thủy lực (Victor)"),
 "工業冰水機": ("Industrial chiller","Máy làm lạnh công nghiệp"),
 "破碎機": ("Granulator","Máy nghiền"),
 "粉碎機": ("Pulverizer","Máy nghiền bột"),
 "轉輪除濕乾燥機": ("Rotor dehumidifying dryer","Máy sấy hút ẩm rotor"),
 "除濕乾燥機": ("Dehumidifying dryer","Máy sấy hút ẩm"),
 "三機一體除濕乾燥機": ("3-in-1 dehumidifying dryer","Máy sấy hút ẩm 3 trong 1"),
 "熱風回收器": ("Hot air recovery unit","Bộ thu hồi khí nóng"),
 "料斗乾燥機": ("Hopper dryer","Máy sấy phễu"),
 "傾斜輸送機": ("Inclined conveyor","Băng tải nghiêng"),
 "顆粒混合機": ("Granule mixer","Máy trộn hạt"),
 "拌料機": ("Material mixer","Máy trộn liệu"),
 "模具冷卻機": ("Mold cooling machine","Máy làm mát khuôn"),
 "模溫機": ("Mold temperature controller","Máy điều nhiệt khuôn"),
 "工業烘箱": ("Industrial oven","Lò sấy công nghiệp"),
 "取出機械手臂": ("Take-out robot","Robot gắp sản phẩm"),
 "自動真空吸料機": ("Vacuum hopper loader","Máy hút liệu chân không"),
 "篩料機": ("Material sieve","Máy sàng liệu"),
 "自動鎖螺絲機": ("Automatic screw driving machine","Máy bắt vít tự động"),
 "CCD 視覺光纖雷射打標機（流水線）": ("CCD vision fiber laser marker (in-line)","Máy khắc laser sợi quang CCD (trên chuyền)"),
 "三軸雙頭自動點膠機": ("3-axis dual-head glue dispenser","Máy bơm keo tự động 3 trục 2 đầu"),
 "AB 膠自動點膠機": ("AB glue automatic dispenser","Máy bơm keo AB tự động"),
 "桌上型鑽床": ("Bench drill","Máy khoan bàn"),
 "電動起子": ("Electric screwdriver","Tua vít điện"),
 "自動螺絲供料機": ("Automatic screw feeder","Máy cấp vít tự động"),
 "雷射打標抽風設備": ("Laser marking fume extractor","Hệ thống hút khói khắc laser"),
 "氣動黃油泵": ("Pneumatic grease pump","Bơm mỡ khí nén"),
 "研磨機": ("Grinder","Máy mài"),
 "半自動膠槍": ("Semi-automatic glue gun","Súng keo bán tự động"),
 "氣動熱壓機": ("Pneumatic heat press","Máy ép nhiệt khí nén"),
 "自動高週波熔接機": ("Automatic high-frequency welder","Máy hàn cao tần tự động"),
 "手動燙金機": ("Manual hot stamping machine","Máy ép nhũ thủ công"),
 "視覺定位光纖雷射打標機": ("Vision-aligned fiber laser marker","Máy khắc laser sợi quang định vị hình ảnh"),
 "組裝輸送線": ("Assembly conveyor line","Băng chuyền lắp ráp"),
 "移印機": ("Pad printing machine","Máy in pad"),
 "移印冷藏櫃": ("Pad printing ink refrigerator","Tủ lạnh mực in pad"),
 "沖壓機": ("Punch press","Máy dập"),
 "氣動鉚釘機": ("Pneumatic riveter","Máy tán đinh khí nén"),
 "自動轉盤週波熔接機": ("Rotary-table HF welder","Máy hàn cao tần mâm xoay"),
 "半自動熔接機": ("Semi-automatic welder","Máy hàn bán tự động"),
 "半自動多功能熔接機": ("Semi-automatic multi-function welder","Máy hàn đa năng bán tự động"),
 "彈簧分離器": ("Spring separator","Máy tách lò xo"),
 "超音波塑膠熔接機": ("Ultrasonic plastic welder","Máy hàn nhựa siêu âm"),
 "手持式超音波塑膠熔接機": ("Handheld ultrasonic welder","Máy hàn siêu âm cầm tay"),
 "連續封口機": ("Continuous band sealer","Máy hàn miệng túi liên tục"),
 "條碼標籤印表機": ("Barcode label printer","Máy in nhãn mã vạch"),
 "自動封箱機（一字貼）": ("Automatic case sealer (I-tape)","Máy dán thùng tự động (kiểu chữ I)"),
 "自動封箱機（左右貼）": ("Automatic case sealer (side tape)","Máy dán thùng tự động (dán hai bên)"),
 "自動封箱機": ("Automatic case sealer","Máy dán thùng tự động"),
 "半自動彩盒貼標機": ("Semi-automatic carton labeller","Máy dán nhãn hộp bán tự động"),
 "封盒蓋機": ("Carton lid closer","Máy đóng nắp hộp"),
 "條碼掃描器": ("Barcode scanner","Máy quét mã vạch"),
 "氣動打包機": ("Pneumatic strapping machine","Máy đai kiện khí nén"),
 "耐磨耗試驗機": ("Abrasion tester","Máy thử mài mòn"),
 "智能數碼老化測試系統": ("Digital ageing test system","Hệ thống thử lão hóa kỹ thuật số"),
 "條碼驗證器": ("Barcode verifier","Máy kiểm định mã vạch"),
 "線材彎折試驗機": ("Cable flex tester","Máy thử uốn dây"),
 "色差儀": ("Colorimeter","Máy đo màu"),
 "直流電源供應器": ("DC power supply","Bộ nguồn DC"),
 "防潮箱": ("Dry cabinet","Tủ chống ẩm"),
 "快充協議電子負載測試儀": ("Fast-charge protocol electronic load tester","Máy thử tải điện tử giao thức sạc nhanh"),
 "快充自動測試儀": ("Fast-charge automatic tester","Máy thử sạc nhanh tự động"),
 "快速充電自動測試儀": ("Fast-charging automatic tester","Máy thử sạc nhanh tự động"),
 "2D 影像量測儀": ("2D vision measuring system","Máy đo hình ảnh 2D"),
 "標準光源對色燈箱": ("Standard light booth","Buồng so màu ánh sáng chuẩn"),
 "照度計": ("Lux meter","Máy đo độ rọi"),
 "磁場測量儀": ("Gauss meter","Máy đo từ trường"),
 "熔融指數儀 (MFI)": ("Melt flow indexer (MFI)","Máy đo chỉ số chảy (MFI)"),
 "鹵素水分測試儀": ("Halogen moisture analyzer","Máy phân tích độ ẩm halogen"),
 "插拔壽命試驗機": ("Insertion-cycle life tester","Máy thử tuổi thọ cắm rút"),
 "推拉力試驗機": ("Push-pull force tester","Máy thử lực kéo đẩy"),
 "洛氏硬度計": ("Rockwell hardness tester","Máy đo độ cứng Rockwell"),
 "鹽霧試驗機": ("Salt spray tester","Máy thử phun muối"),
 "硬度計": ("Hardness tester","Máy đo độ cứng"),
 "恆溫恆濕試驗箱": ("Temperature & humidity chamber","Tủ thử nhiệt độ - độ ẩm"),
 "螺絲扭力測試儀": ("Screw torque tester","Máy thử lực siết vít"),
 "扭力測試扳手": ("Torque wrench","Cờ lê lực"),
 "耐黃變試驗機": ("UV yellowing tester","Máy thử ố vàng UV"),
 "電磁振動試驗機": ("Electromagnetic vibration tester","Máy thử rung điện từ"),
 "X 射線螢光光譜儀 (XRF)": ("X-ray fluorescence spectrometer (XRF)","Máy quang phổ huỳnh quang tia X (XRF)"),
 "數顯卡尺": ("Digital caliper","Thước cặp điện tử"),
 "數顯深度規": ("Digital depth gauge","Thước đo sâu điện tử"),
 "錶盤卡尺": ("Dial caliper","Thước cặp đồng hồ"),
 "標準塊規（47 件組）": ("Gauge block set (47 pcs)","Bộ căn mẫu (47 chi tiết)"),
 "電子高度計": ("Digital height gauge","Thước đo cao điện tử"),
 "數顯外徑千分尺（含座）": ("Digital micrometer with stand","Panme điện tử (có đế)"),
 "螺紋塞規 Go/NoGo": ("Thread plug gauge Go/NoGo","Dưỡng ren trục Go/NoGo"),
 "螺紋環規 Go/NoGo": ("Thread ring gauge Go/NoGo","Dưỡng ren vòng Go/NoGo"),
}

def main(src, out):
    df = pd.read_excel(src, header=0)
    df.columns = ['cat','name','spec','loc','qty']
    df['qty'] = pd.to_numeric(df['qty'], errors='coerce').fillna(0).astype(int)

    missing = sorted({n for n in df['name'] if n not in NAME})
    if missing:
        print("UNTRANSLATED NAMES:", *missing, sep="\n  "); sys.exit(1)
    badloc = sorted({l for l in df['loc'] if l not in LOC})
    if badloc:
        print("UNTRANSLATED LOCATIONS:", *badloc, sep="\n  "); sys.exit(1)

    groups = collections.OrderedDict()
    for cat in CAT:
        rows = []
        for _, r in df[df['cat'] == cat].iterrows():
            spec = str(r['spec']).strip()
            tbc = spec in ('待補', 'nan', '—', '')
            rows.append({
                "name": {"zh": r['name'], "en": NAME[r['name']][0], "vi": NAME[r['name']][1]},
                "spec": "—" if tbc else spec,
                "tbc": tbc,
                "loc":  {"zh": r['loc'], "en": LOC[r['loc']][0], "vi": LOC[r['loc']][1]},
                "qty":  int(r['qty']),
            })
        groups[cat] = {
            "title": {"zh": cat, "en": CAT[cat][0], "vi": CAT[cat][1]},
            "units": sum(x['qty'] for x in rows),
            "rows": rows,
        }

    inj = groups["射出成型機"]["rows"]
    vert = sum(r['qty'] for r in inj if '立式' in r['name']['zh'])
    tons = sorted({int(m) for r in inj for m in re.findall(r'(\d+)\s*T', r['spec'])})
    data = {
        "_comment": "由 scripts/build_equipment_json.py 從越南廠設備清單 xlsx 產生，勿手動編輯",
        "source": "怡業越南廠設備清單_ZH.xlsx",
        "scope": {"zh": "越南廠（一廠／二廠）", "en": "Vietnam plant (Plant 1 / Plant 2)",
                   "vi": "Nhà máy Việt Nam (Nhà máy 1 / Nhà máy 2)"},
        "summary": {
            "injection_total": sum(r['qty'] for r in inj),
            "injection_vertical": vert,
            "injection_horizontal": sum(r['qty'] for r in inj) - vert,
            "tonnage_min": min(tons), "tonnage_max": max(tons),
            "total_units": int(df['qty'].sum()),
            "tbc_rows": sum(1 for g in groups.values() for r in g['rows'] if r['tbc']),
        },
        "groups": [dict(key=k, **v) for k, v in groups.items()],
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2); f.write('\n')
    s = data['summary']
    print(f"✓ {out}")
    print(f"  injection {s['injection_total']} ({s['injection_horizontal']} horizontal + {s['injection_vertical']} vertical)")
    print(f"  clamping  {s['tonnage_min']}–{s['tonnage_max']} T")
    print(f"  total     {s['total_units']} units in {len(data['groups'])} groups, {s['tbc_rows']} rows without a model")

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
