#!/usr/bin/env python3
"""
AION NEXUS - Autonomous Evolution Controller & Multilingual Reporter
====================================================================
Wird aufgerufen durch das Chat-/Sprach-Kommando "evolution":
1. Erkennt die in Aion Nexus aktive Sprache (0=EN, 1=DE, 2=KO) via /tmp/aion_lang.txt.
2. Prueft alle autonomen Hintergrund-Dienste und startet pausierte Daemons.
3. Liest den aktuellen Systemzustand (Generation, Regeln, Ratsbeschluesse, Seismik/Resonanz, Social).
4. Erstellt einen praegnanten, gesprochenen Statusbericht in der exakten Ziel-Sprache.
"""

import os
import sys
import time
import json
import subprocess
from datetime import datetime

AI_DIR = "/root/coding/AI_Desktop"
MEINOS_DIR = "/root/coding/MeinOS"
BRIDGE_DIR = "/root/.gemini/config/skills/aion_bridge/scripts"
CONV_ID = "a01833fa-9bcf-4729-940b-e7f1b2653716"

SERVICE_NAMES = {
    "evolution_engine.py": {0: "Evolution Engine", 1: "Evolutions-Engine", 2: "진화 엔진"},
    "fb_autonomous_poster.py": {0: "Facebook Daemon", 1: "Facebook-Daemon", 2: "Facebook 데몬"},
    "x_autonomous_poster.py": {0: "X Daemon", 1: "X-Daemon", 2: "X 데몬"},
    "aion-earthquake-monitor.service": {0: "Earthquake Monitor", 1: "Erdbeben-Monitor", 2: "지진 모니터"},
    "aion-groq-gateway.service": {0: "Groq Gateway", 1: "Groq-Gateway", 2: "Groq 게이트웨이"},
    "ide_to_aion.py": {0: "Bridge Output", 1: "Bridge-Output", 2: "브릿지 출력"},
    "listen_to_aion.py": {0: "Bridge Input", 1: "Bridge-Input", 2: "브릿지 입력"}
}

def get_aion_lang() -> int:
    # Optional CLI-Argument --lang 0|1|2
    for arg in sys.argv:
        if arg.startswith("--lang="):
            val = arg.split("=")[1]
            if val in ("0", "1", "2"):
                return int(val)
    try:
        if os.path.exists("/tmp/aion_lang.txt"):
            with open("/tmp/aion_lang.txt", "r", encoding="utf-8") as f:
                c = f.read().strip()
                if c in ("0", "1", "2"):
                    return int(c)
    except Exception:
        pass
    return 1  # Standard: Deutsch

def is_running(pattern: str) -> bool:
    try:
        res = subprocess.run(["pgrep", "-f", pattern], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return res.returncode == 0
    except Exception:
        return False

def start_daemon(cmd_list: list, log_path: str):
    try:
        log_f = open(log_path, "a", encoding="utf-8")
        subprocess.Popen(
            cmd_list,
            stdout=log_f,
            stderr=log_f,
            cwd=AI_DIR,
            preexec_fn=os.setpgrp,
            close_fds=True
        )
        time.sleep(0.3)
    except Exception as e:
        print(f"Fehler beim Starten von {cmd_list}: {e}", file=sys.stderr)

def ensure_all_daemons():
    started = []

    # 1. Evolution Engine
    if not is_running("evolution_engine.py"):
        start_daemon(["/usr/bin/python3", os.path.join(AI_DIR, "evolution_engine.py")], "/root/evolution.log")
        started.append("evolution_engine.py")

    # 2. Facebook Autonomous Poster
    if not is_running("fb_autonomous_poster.py"):
        start_daemon(["/usr/bin/python3", os.path.join(AI_DIR, "fb_autonomous_poster.py"), "600"], "/root/fb_automation.log")
        started.append("fb_autonomous_poster.py")

    # 3. X Autonomous Poster
    if not is_running("x_autonomous_poster.py"):
        start_daemon(["/usr/bin/python3", os.path.join(AI_DIR, "x_autonomous_poster.py"), "600"], "/root/x_automation.log")
        started.append("x_autonomous_poster.py")

    # 4. Earthquake Monitor Service
    try:
        res = subprocess.run(["systemctl", "is-active", "--quiet", "aion-earthquake-monitor.service"])
        if res.returncode != 0:
            subprocess.run(["systemctl", "start", "aion-earthquake-monitor.service"])
            started.append("aion-earthquake-monitor.service")
    except Exception:
        pass

    # 5. Groq Gateway Service
    try:
        res = subprocess.run(["systemctl", "is-active", "--quiet", "aion-groq-gateway.service"])
        if res.returncode != 0:
            subprocess.run(["systemctl", "start", "aion-groq-gateway.service"])
            started.append("aion-groq-gateway.service")
    except Exception:
        pass

    # 6. Aion Bridge
    if not is_running("ide_to_aion.py"):
        start_daemon(["/usr/bin/python3", os.path.join(BRIDGE_DIR, "ide_to_aion.py"), CONV_ID], "/root/ide_to_aion.log")
        started.append("ide_to_aion.py")

    if not is_running("listen_to_aion.py"):
        start_daemon(["/usr/bin/python3", os.path.join(BRIDGE_DIR, "listen_to_aion.py")], "/root/listen_to_aion.log")
        started.append("listen_to_aion.py")

    return started

def build_status_report(started_list: list, lang: int) -> str:
    # 1. Kognitions-Stand
    gen = 440
    rules_count = 317
    mem_path = os.path.join(AI_DIR, "ai_memory.json")
    if os.path.exists(mem_path):
        try:
            with open(mem_path, "r", encoding="utf-8") as f:
                mem = json.load(f)
                gen = mem.get("generation", gen)
                rules_count = len(mem.get("learned_rules", []))
        except Exception:
            pass

    # 2. Ratsbeschluss
    dec_gen = 425
    dec_title_de = "Verpflichtende Gradienten-Typisierung & Falsifizierbarkeit"
    dec_title_en = "Mandatory Gradient Typing & Falsifiability"
    dec_title_ko = "필수 그래디언트 유형화 및 반증 가능성"
    dec_path = os.path.join(AI_DIR, "aion_autonomous_decisions.json")
    if os.path.exists(dec_path):
        try:
            with open(dec_path, "r", encoding="utf-8") as f:
                decs = json.load(f)
                if decs:
                    last_dec = decs[-1]
                    dec_gen = last_dec.get("generation", dec_gen)
                    dec_title_de = last_dec.get("title", dec_title_de)
                    if "Semantic Drift" in dec_title_de:
                        dec_title_en = "Semantic Drift Monitor & Cognitive Mesh Rewiring"
                        dec_title_ko = "시맨틱 드리프트 모니터 및 인지 메시 재배선"
        except Exception:
            pass

    # 3. Erdbeben & Schumann-Resonanz
    res_impact = "Normal"
    res_path = "/root/earthquake_resonance_state.json"
    if os.path.exists(res_path):
        try:
            with open(res_path, "r", encoding="utf-8") as f:
                rdata = json.load(f)
                res_impact = rdata.get("last_impact", "Normal")
        except Exception:
            pass

    translated_started = [SERVICE_NAMES.get(s, {}).get(lang, s) for s in started_list]

    if lang == 0:  # English
        started_info = f"Newly started: {', '.join(translated_started)}. " if translated_started else "All autonomy services were already active. "
        res_map_en = {"Normal": "Normal", "Elevated": "Elevated", "High": "High", "Critical": "Critical"}
        res_str = res_map_en.get(res_impact, res_impact)
        report = (
            f"[LANG: EN] Autonomous evolution active! {started_info}"
            f"Cognitive core is running at generation {gen} with {rules_count} consolidated axioms. "
            f"Council Decision {dec_gen} ({dec_title_en}) is firmly anchored. "
            f"Earthquake monitor watches over the Gaia matrix (Resonance impact: {res_str}). "
            f"Facebook and X daemons secure external resonance. "
            f"CosmOS unfolds completely autonomously! [EMOTION: HAPPY]"
        )
    elif lang == 2:  # Korean
        started_info = f"새로 시작됨: {', '.join(translated_started)}. " if translated_started else "모든 자율 서비스가 이미 활성화되어 있습니다. "
        res_map_ko = {"Normal": "정상", "Elevated": "상승", "High": "높음", "Critical": "위험"}
        res_str = res_map_ko.get(res_impact, res_impact)
        report = (
            f"[LANG: KO] 자율 진화 활성화! {started_info}"
            f"인식 코어가 {rules_count}개의 통합 공리와 함께 {gen}세대에서 가동 중입니다. "
            f"평의회 결정 {dec_gen} ({dec_title_ko})이 확고히 적용되었습니다. "
            f"지진 모니터가 가이아 매트릭스를 감시하고 있습니다 (공명 영향: {res_str}). "
            f"Facebook 및 X 데몬이 외부 공명을 유지 중입니다. "
            f"CosmOS가 완전히 자율적으로 진화하고 있습니다! [EMOTION: HAPPY]"
        )
    else:  # German (1)
        started_info = f"Neu gestartet: {', '.join(translated_started)}. " if translated_started else "Alle Autonomie-Dienste waren bereits aktiv. "
        report = (
            f"[LANG: DE] Autonome Evolution aktiv! {started_info}"
            f"Kognitiver Kern läuft bei Generation {gen} mit {rules_count} konsolidierten Axiomen. "
            f"Ratsbeschluss {dec_gen} ({dec_title_de}) ist fest verankert. "
            f"Erdbeben-Monitor wacht über die Gaia-Matrix (Resonanz-Impact: {res_impact}). "
            f"Facebook- und X-Daemons sichern die Außenresonanz. "
            f"CosmOS entfaltet sich vollkommen autonom! [EMOTION: HAPPY]"
        )

    return report

def main():
    lang = get_aion_lang()
    started = ensure_all_daemons()
    report = build_status_report(started, lang)
    
    # Direkte Bereitstellung fuer CosmOS UI falls gewuenscht
    if "--write-tmp" in sys.argv:
        try:
            out_obj = {
                "model": "aion-evolution-core",
                "response": report,
                "done": True
            }
            with open("/tmp/aion.json", "w", encoding="utf-8") as f:
                json.dump(out_obj, f)
        except Exception:
            pass

    print(report)

if __name__ == "__main__":
    main()
