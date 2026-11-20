import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as echarts from 'echarts';
import { AircraftModelType, AeroTelemetry } from '../types/aerodynamics';
import { calculateAeroTelemetry, getEffectiveStallAngles } from '../utils/airfoilGenerators';
import { downloadCurveDataCSV } from '../utils/telemetryExport';
import {
  ChartLineUp,
  DownloadSimple,
  CaretDown,
  FilePng,
  FileSvg,
  FileCsv,
  CheckCircle,
} from '@phosphor-icons/react';

interface AeroChartsProps {
  modelType: AircraftModelType;
  currentAoa: number;
  airspeedKts: number;
  altitudeFt: number;
  flapsDeg: number;
  telemetry: AeroTelemetry;
}

interface PolarPoint {
  aoa: number;
  cl: number;
  cd: number;
  ldRatio: number;
  isStalled: boolean;
  flowState: string;
}

export const AeroCharts: React.FC<AeroChartsProps> = ({
  modelType,
  currentAoa,
  airspeedKts,
  altitudeFt,
  flapsDeg,
  telemetry,
}) => {
  const [activeTab, setActiveTab] = useState<'lift' | 'dragPolar' | 'pressure'>('lift');
  const [showChartExportMenu, setShowChartExportMenu] = useState(false);
  const [chartSuccessMsg, setChartSuccessMsg] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const chartMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chartMenuRef.current && !chartMenuRef.current.contains(event.target as Node)) {
        setShowChartExportMenu(false);
      }
    };
    if (showChartExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showChartExportMenu]);

  // High-resolution AoA sweep (-20 deg to +30 deg in 0.5 deg increments)
  const aoaSweep = useMemo<PolarPoint[]>(() => {
    const pts: PolarPoint[] = [];
    for (let a = -20; a <= 30.001; a += 0.5) {
      const aoa = Math.round(a * 10) / 10;
      const pt = calculateAeroTelemetry(modelType, aoa, airspeedKts, altitudeFt, flapsDeg);
      pts.push({
        aoa,
        cl: pt.cl,
        cd: pt.cd,
        ldRatio: pt.ldRatio,
        isStalled: pt.isStalled,
        flowState: pt.flowState,
      });
    }
    return pts;
  }, [modelType, airspeedKts, altitudeFt, flapsDeg]);

  // Pressure distribution along normalized chord (x/c in [0, 1])
  const cpSweep = useMemo(() => {
    const pts: { xc: number; cpUpper: number; cpLower: number }[] = [];
    const effectiveCl = Math.max(0.1, telemetry.cl);
    for (let i = 0; i <= 40; i++) {
      const xc = i / 40;
      const rawUpper =
        -effectiveCl * 1.8 * (Math.pow(1 - xc, 0.45) / Math.sqrt(Math.max(0.04, xc))) + 0.15;
      const rawLower = effectiveCl * 0.7 * Math.pow(1 - xc, 0.75);
      pts.push({
        xc: Number(xc.toFixed(3)),
        cpUpper: Number(Math.max(-3.5, Math.min(1.0, rawUpper)).toFixed(3)),
        cpLower: Number(Math.max(-0.5, Math.min(1.0, rawLower)).toFixed(3)),
      });
    }
    return pts;
  }, [telemetry.cl]);

  // Initialize Apache ECharts instance (SVG renderer + ResizeObserver)
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (chart && !chart.isDisposed()) {
        chart.resize();
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      if (!chart.isDisposed()) {
        chart.dispose();
      }
      chartInstanceRef.current = null;
    };
  }, []);

  // Build & update ECharts option whenever activeTab or telemetry/parameters change
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart || chart.isDisposed()) return;

    const { posStallAngle: effectiveStall, negStallAngle } = getEffectiveStallAngles(
      modelType,
      flapsDeg
    );
    const negStall = negStallAngle > 0 ? -negStallAngle : 0;

    const commonTooltip = {
      trigger: 'axis' as const,
      confine: true,
      backgroundColor: 'rgba(22, 26, 29, 0.94)',
      borderColor: '#334155',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {
        color: '#F8FAFC',
        fontSize: 11,
        fontFamily: '"JetBrains Mono", monospace',
      },
      axisPointer: {
        type: 'cross' as const,
        lineStyle: { color: '#94A3B8', width: 1, type: 'dashed' as const },
        crossStyle: { color: '#94A3B8', width: 1, type: 'dashed' as const },
        label: {
          backgroundColor: '#1769AA',
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
        },
      },
    };

    let option: echarts.EChartsOption;

    if (activeTab === 'lift') {
      const curveData = aoaSweep.map((p) => [p.aoa, p.cl, p.cd, p.ldRatio, p.isStalled ? 1 : 0]);
      const stallZones: Array<[{ xAxis: number }, { xAxis: number }]> = [];
      if (effectiveStall > 0) {
        if (effectiveStall < 30) {
          stallZones.push([{ xAxis: effectiveStall }, { xAxis: 30 }]);
        }
        if (negStall > -20) {
          stallZones.push([{ xAxis: -20 }, { xAxis: negStall }]);
        }
      }

      const opColor = telemetry.isStalled ? '#DC2626' : '#1769AA';

      option = {
        animationDuration: 300,
        grid: { left: 42, right: 16, top: 26, bottom: 32 },
        tooltip: {
          ...commonTooltip,
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const first = list[0] as { data?: number[] };
            if (!first?.data) return '';
            const [aoa, cl, cd, ld, stalled] = first.data;
            if (cd === undefined) {
              return `<div style="font-weight:700;color:#38BDF8">Operating Point</div>
                <div>α: ${currentAoa >= 0 ? '+' : ''}${currentAoa.toFixed(1)}°</div>
                <div>CL: ${telemetry.cl.toFixed(3)} · L/D: ${telemetry.ldRatio.toFixed(1)}</div>`;
            }
            return `
              <div style="font-weight:700;margin-bottom:3px;color:${stalled ? '#F87171' : '#38BDF8'}">
                α = ${aoa >= 0 ? '+' : ''}${aoa.toFixed(1)}° ${stalled ? '· STALL' : '· Attached'}
              </div>
              <div>CL: <b>${cl.toFixed(3)}</b> · CD: <b>${cd.toFixed(3)}</b></div>
              <div>L/D: <b>${ld.toFixed(1)}:1</b></div>
            `;
          },
        },
        xAxis: {
          type: 'value',
          min: -20,
          max: 30,
          interval: 10,
          name: 'α (°)',
          nameLocation: 'end',
          nameGap: 6,
          nameTextStyle: { color: '#5C6670', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { lineStyle: { color: '#CBD5E1' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => `${v}°`,
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        yAxis: {
          type: 'value',
          min: -1.8,
          max: 2.6,
          interval: 1.0,
          name: 'CL',
          nameTextStyle: { color: '#5C6670', fontSize: 10, padding: [0, 24, 0, 0], fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => v.toFixed(1),
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        series: [
          {
            name: 'CL Polar',
            type: 'line',
            smooth: 0.25,
            showSymbol: false,
            data: curveData,
            lineStyle: { color: '#1769AA', width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(23, 105, 170, 0.20)' },
                { offset: 1, color: 'rgba(23, 105, 170, 0.01)' },
              ]),
            },
            markArea: stallZones.length
              ? {
                  silent: true,
                  itemStyle: { color: 'rgba(220, 38, 38, 0.08)' },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: '#DC2626',
                    fontSize: 9,
                    fontFamily: '"JetBrains Mono", monospace',
                  },
                  data: stallZones.map((zone, idx) => [
                    { ...zone[0], name: idx === 0 ? 'STALL' : '' },
                    zone[1],
                  ]),
                }
              : undefined,
            markLine: {
              silent: true,
              symbol: 'none',
              data: [
                { yAxis: 0, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1 }, label: { show: false } },
                { xAxis: 0, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1 }, label: { show: false } },
                ...(effectiveStall > 0
                  ? [
                      {
                        xAxis: effectiveStall,
                        lineStyle: { color: 'rgba(220, 38, 38, 0.55)', type: 'dashed' as const, width: 1.2 },
                        label: {
                          show: true,
                          formatter: `αcrit +${effectiveStall.toFixed(0)}°`,
                          position: 'insideEndTop' as const,
                          color: '#DC2626',
                          fontSize: 9,
                          fontFamily: '"JetBrains Mono", monospace',
                        },
                      },
                      ...(negStall > -20
                        ? [
                            {
                              xAxis: negStall,
                              lineStyle: { color: 'rgba(220, 38, 38, 0.45)', type: 'dashed' as const, width: 1.1 },
                              label: {
                                show: true,
                                formatter: `${negStall.toFixed(0)}°`,
                                position: 'insideEndBottom' as const,
                                color: '#DC2626',
                                fontSize: 9,
                                fontFamily: '"JetBrains Mono", monospace',
                              },
                            },
                          ]
                        : []),
                    ]
                  : []),
              ],
            },
          },
          {
            name: 'Operating Point',
            type: 'effectScatter',
            symbolSize: 10,
            rippleEffect: { scale: 2.6, brushType: 'stroke' },
            itemStyle: { color: opColor, borderColor: '#FFFFFF', borderWidth: 2 },
            data: [[currentAoa, telemetry.cl]],
            label: {
              show: true,
              position: currentAoa > 14 ? 'left' : telemetry.cl > 1.7 ? 'bottom' : 'top',
              distance: 8,
              formatter: () =>
                `α ${currentAoa >= 0 ? '+' : ''}${currentAoa.toFixed(1)}° · CL ${telemetry.cl.toFixed(2)}`,
              color: opColor,
              backgroundColor: 'rgba(255,255,255,0.92)',
              borderColor: opColor,
              borderWidth: 1,
              borderRadius: 4,
              padding: [2, 5],
              fontSize: 10,
              fontWeight: 700,
              fontFamily: '"JetBrains Mono", monospace',
            },
          },
        ],
      };
    } else if (activeTab === 'dragPolar') {
      const polarData = aoaSweep.map((p) => [p.cd, p.cl, p.aoa, p.ldRatio]);
      const maxCdVal = Math.max(
        0.5,
        Math.min(1.8, Math.ceil(Math.max(...aoaSweep.map((p) => p.cd), telemetry.cd) * 10) / 10 + 0.05)
      );

      // Find peak L/D point for the maximum efficiency tangent ray
      let bestPt = aoaSweep[0];
      for (const p of aoaSweep) {
        if (p.ldRatio > bestPt.ldRatio) bestPt = p;
      }
      const rayScale = bestPt.cd > 0.005 ? Math.min(2.2 / Math.max(0.1, bestPt.cl), maxCdVal / bestPt.cd) : 1;
      const rayEndCd = Number((bestPt.cd * rayScale).toFixed(3));
      const rayEndCl = Number((bestPt.cl * rayScale).toFixed(3));
      const opColor = telemetry.isStalled ? '#DC2626' : '#D97706';

      option = {
        animationDuration: 300,
        grid: { left: 42, right: 16, top: 26, bottom: 32 },
        tooltip: {
          ...commonTooltip,
          trigger: 'item',
          formatter: (params: unknown) => {
            const item = params as { data?: number[] };
            if (!item?.data) return '';
            const [cd, cl, aoa, ld] = item.data;
            if (aoa === undefined) {
              return `<div style="font-weight:700;color:#FBBF24">Current Operating Point</div>
                <div>CD: <b>${telemetry.cd.toFixed(3)}</b> · CL: <b>${telemetry.cl.toFixed(3)}</b></div>
                <div>L/D: <b>${telemetry.ldRatio.toFixed(1)}:1</b></div>`;
            }
            return `
              <div style="font-weight:700;margin-bottom:3px;color:#FBBF24">
                Drag Polar · α = ${aoa >= 0 ? '+' : ''}${aoa.toFixed(1)}°
              </div>
              <div>CD: <b>${cd.toFixed(3)}</b> · CL: <b>${cl.toFixed(3)}</b></div>
              <div>L/D: <b>${ld.toFixed(1)}:1</b></div>
            `;
          },
        },
        xAxis: {
          type: 'value',
          min: 0,
          max: maxCdVal,
          name: 'CD',
          nameLocation: 'end',
          nameGap: 6,
          nameTextStyle: { color: '#5C6670', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { lineStyle: { color: '#CBD5E1' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => v.toFixed(2),
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        yAxis: {
          type: 'value',
          min: -1.6,
          max: 2.5,
          interval: 1.0,
          name: 'CL',
          nameTextStyle: { color: '#5C6670', fontSize: 10, padding: [0, 24, 0, 0], fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => v.toFixed(1),
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        series: [
          {
            name: 'Drag Polar',
            type: 'line',
            smooth: 0.25,
            showSymbol: false,
            data: polarData,
            lineStyle: { color: '#D97706', width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(217, 119, 6, 0.16)' },
                { offset: 1, color: 'rgba(217, 119, 6, 0.01)' },
              ]),
            },
            markLine: {
              silent: true,
              symbol: 'none',
              data: [
                { yAxis: 0, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1 }, label: { show: false } },
                ...(bestPt.ldRatio > 1.5
                  ? [
                      [
                        { coord: [0, 0] },
                        {
                          coord: [rayEndCd, rayEndCl],
                          lineStyle: { color: '#10B981', type: 'dashed' as const, width: 1.5 },
                          label: {
                            show: true,
                            formatter: `(L/D)max ${bestPt.ldRatio.toFixed(1)}`,
                            color: '#059669',
                            fontSize: 9,
                            fontFamily: '"JetBrains Mono", monospace',
                          },
                        },
                      ] as [{ coord: [number, number] }, { coord: [number, number]; lineStyle: { color: string; type: 'dashed'; width: number }; label: { show: boolean; formatter: string; color: string; fontSize: number; fontFamily: string } }],
                    ]
                  : []),
              ],
            },
          },
          {
            name: 'Operating Point',
            type: 'effectScatter',
            symbolSize: 10,
            rippleEffect: { scale: 2.6, brushType: 'stroke' },
            itemStyle: { color: opColor, borderColor: '#FFFFFF', borderWidth: 2 },
            data: [[Math.min(maxCdVal, telemetry.cd), telemetry.cl]],
            label: {
              show: true,
              position: telemetry.cd > maxCdVal * 0.65 ? 'left' : 'top',
              distance: 8,
              formatter: () => `CD ${telemetry.cd.toFixed(3)} · CL ${telemetry.cl.toFixed(2)}`,
              color: opColor,
              backgroundColor: 'rgba(255,255,255,0.92)',
              borderColor: opColor,
              borderWidth: 1,
              borderRadius: 4,
              padding: [2, 5],
              fontSize: 10,
              fontWeight: 700,
              fontFamily: '"JetBrains Mono", monospace',
            },
          },
        ],
      };
    } else {
      option = {
        animationDuration: 300,
        grid: { left: 42, right: 16, top: 30, bottom: 32 },
        legend: {
          top: 2,
          right: 8,
          itemWidth: 12,
          itemHeight: 3,
          textStyle: { color: '#5C6670', fontSize: 10, fontFamily: 'sans-serif' },
          data: ['Upper Suction (-Cp)', 'Lower Compression (+Cp)'],
        },
        tooltip: {
          ...commonTooltip,
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const first = list[0] as { axisValue?: number };
            if (!first) return '';
            const xc = Number(first.axisValue ?? 0);
            const upperVal = (list[0] as { data?: number[] })?.data?.[1] ?? 0;
            const lowerVal = (list[1] as { data?: number[] })?.data?.[1] ?? 0;
            const deltaCp = lowerVal - upperVal;
            return `
              <div style="font-weight:700;margin-bottom:3px;color:#38BDF8">
                Chord Station x/c = ${(xc * 100).toFixed(0)}%
              </div>
              <div style="color:#60A5FA">Upper Cp: <b>${upperVal.toFixed(2)}</b></div>
              <div style="color:#FBBF24">Lower Cp: <b>${lowerVal >= 0 ? '+' : ''}${lowerVal.toFixed(2)}</b></div>
              <div>ΔCp Loading: <b>${deltaCp.toFixed(2)}</b></div>
            `;
          },
        },
        xAxis: {
          type: 'value',
          min: 0,
          max: 1,
          interval: 0.25,
          name: 'x/c',
          nameLocation: 'end',
          nameGap: 6,
          nameTextStyle: { color: '#5C6670', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { lineStyle: { color: '#CBD5E1' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => v.toFixed(2),
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        yAxis: {
          type: 'value',
          inverse: true, // Aerospace convention: suction (-Cp) upwards
          min: -3.5,
          max: 1.2,
          interval: 1.5,
          name: 'Cp',
          nameTextStyle: { color: '#5C6670', fontSize: 10, padding: [0, 24, 0, 0], fontFamily: '"JetBrains Mono", monospace' },
          axisLine: { show: false },
          axisLabel: {
            color: '#5C6670',
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            formatter: (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
          },
          splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        },
        series: [
          {
            name: 'Upper Suction (-Cp)',
            type: 'line',
            smooth: 0.25,
            showSymbol: false,
            data: cpSweep.map((p) => [p.xc, p.cpUpper]),
            lineStyle: { color: '#1769AA', width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(23, 105, 170, 0.20)' },
                { offset: 1, color: 'rgba(23, 105, 170, 0.02)' },
              ]),
            },
            markLine: {
              silent: true,
              symbol: 'none',
              data: [{ yAxis: 0, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1 }, label: { show: false } }],
            },
          },
          {
            name: 'Lower Compression (+Cp)',
            type: 'line',
            smooth: 0.25,
            showSymbol: false,
            data: cpSweep.map((p) => [p.xc, p.cpLower]),
            lineStyle: { color: '#D97706', width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 1, 0, 0, [
                { offset: 0, color: 'rgba(217, 119, 6, 0.16)' },
                { offset: 1, color: 'rgba(217, 119, 6, 0.01)' },
              ]),
            },
          },
        ],
      };
    }

    chart.setOption(option, { notMerge: true });
  }, [activeTab, aoaSweep, cpSweep, modelType, flapsDeg, currentAoa, telemetry]);

  const getBaseName = () => {
    const tabSuffix =
      activeTab === 'lift'
        ? 'lift_curve_cl_alpha'
        : activeTab === 'dragPolar'
        ? 'drag_polar_cl_cd'
        : 'pressure_dist_cp';
    return `aerolab_${modelType}_${tabSuffix}_aoa${currentAoa >= 0 ? '+' : ''}${currentAoa.toFixed(1)}deg`;
  };

  const getExportableSvgClone = (): { clone: SVGSVGElement; w: number; h: number } | null => {
    const svgEl = chartContainerRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const w = Math.max(440, svgEl.clientWidth || 440);
    const h = Math.max(210, svgEl.clientHeight || 220);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    clone.setAttribute('width', `${w}`);
    clone.setAttribute('height', `${h}`);

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', '#F7F9FA');
    clone.insertBefore(bgRect, clone.firstChild);

    return { clone, w, h };
  };

  const handleExportSvg = () => {
    const exported = getExportableSvgClone();
    if (!exported) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(exported.clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getBaseName()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setChartSuccessMsg('SVG Saved');
    setShowChartExportMenu(false);
    setTimeout(() => setChartSuccessMsg(null), 3000);
  };

  const handleExportPng = async () => {
    const exported = getExportableSvgClone();
    if (!exported) return;
    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(exported.clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = exported.w * scale;
          canvas.height = exported.h * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            reject(new Error('Canvas context unavailable'));
            return;
          }
          ctx.fillStyle = '#F7F9FA';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('PNG export failed'));
              return;
            }
            const dlUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = dlUrl;
            link.download = `${getBaseName()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(dlUrl);
            resolve();
          }, 'image/png');
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        };
        img.src = url;
      });
      setChartSuccessMsg('PNG Saved');
    } catch (e) {
      console.error(e);
      setChartSuccessMsg('Export Error');
    }
    setShowChartExportMenu(false);
    setTimeout(() => setChartSuccessMsg(null), 3000);
  };

  const handleExportCurveCsv = () => {
    const baseName = getBaseName();
    if (activeTab === 'lift') {
      const points = aoaSweep.map((pt) => ({
        x: pt.aoa,
        y: pt.cl,
        label: pt.isStalled ? 'Stalled' : 'Attached',
      }));
      downloadCurveDataCSV(points, 'Angle of Attack (deg)', 'Lift Coefficient (CL)', baseName);
    } else if (activeTab === 'dragPolar') {
      const points = aoaSweep.map((pt) => ({
        x: pt.cd,
        y: pt.cl,
        label: `AoA=${pt.aoa.toFixed(1)}deg`,
      }));
      downloadCurveDataCSV(points, 'Drag Coefficient (CD)', 'Lift Coefficient (CL)', baseName);
    } else {
      const points: Array<{ x: number; y: number; label: string }> = [];
      for (const p of cpSweep) {
        points.push({ x: p.xc, y: p.cpUpper, label: 'Upper Suction (-Cp)' });
        points.push({ x: p.xc, y: p.cpLower, label: 'Lower Compression (+Cp)' });
      }
      downloadCurveDataCSV(points, 'Chord Position (x/c)', 'Pressure Coefficient (Cp)', baseName);
    }
    setChartSuccessMsg('Data Saved');
    setShowChartExportMenu(false);
    setTimeout(() => setChartSuccessMsg(null), 3000);
  };

  return (
    <div className="w-full p-3 sm:p-3.5 rounded-xl antigravity-glass flex flex-col gap-2.5">
      {/* Chart Header & Tabs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#1769AA]/16 to-[#0EA5E9]/14 ring-1 ring-[#1769AA]/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] flex items-center justify-center text-[#1769AA] shrink-0">
              <ChartLineUp weight="duotone" className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold text-[#161A1D] tracking-wide uppercase font-sans truncate">
              Aerodynamic Polars
            </span>
            {chartSuccessMsg && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-mono flex items-center gap-1 shrink-0">
                <CheckCircle weight="duotone" className="w-3 h-3 text-emerald-600" />
                <span>{chartSuccessMsg}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-[#1769AA] font-mono tabular-nums font-semibold hidden sm:inline">
              α: {currentAoa >= 0 ? '+' : ''}{currentAoa.toFixed(1)}°
            </span>

            {/* Export Chart Dropdown Menu */}
            <div className="relative" ref={chartMenuRef}>
              <button
                onClick={() => setShowChartExportMenu((prev) => !prev)}
                className="px-2 py-0.5 rounded-md bg-[var(--bg)] border border-[var(--border)] hover:border-[#1769AA] text-[10px] font-semibold text-[#161A1D] flex items-center gap-1 transition-colors cursor-pointer"
                title="Export graph as high-res PNG, vector SVG, or raw CSV points"
                aria-expanded={showChartExportMenu}
                aria-haspopup="true"
              >
                <DownloadSimple weight="bold" className="w-3 h-3 text-[#1769AA]" />
                <span>Export Graph</span>
                <CaretDown
                  weight="bold"
                  className={`w-2.5 h-2.5 text-[#5C6670] transition-transform duration-200 ${
                    showChartExportMenu ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {showChartExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 max-w-[calc(100vw-2rem)] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xl p-1.5 z-50 flex flex-col gap-1">
                  <div className="px-2 py-1 border-b border-[var(--border)]">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#5C6670]">
                      Export Active Graph
                    </span>
                  </div>

                  <button
                    onClick={handleExportPng}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--bg)] flex items-center gap-2 text-[#161A1D] transition-colors cursor-pointer"
                  >
                    <FilePng weight="duotone" className="w-4 h-4 text-[#1769AA] shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-[#161A1D] flex items-center gap-1">
                        High-Res Image
                        <span className="text-[9px] font-mono px-1 rounded bg-[var(--accent-light)] text-[#1769AA]">
                          .png
                        </span>
                      </span>
                      <span className="text-[9px] text-[#5C6670]">Crisp 2× raster render</span>
                    </div>
                  </button>

                  <button
                    onClick={handleExportSvg}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--bg)] flex items-center gap-2 text-[#161A1D] transition-colors cursor-pointer"
                  >
                    <FileSvg weight="duotone" className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-[#161A1D] flex items-center gap-1">
                        Vector Graphic
                        <span className="text-[9px] font-mono px-1 rounded bg-amber-50 text-amber-700">
                          .svg
                        </span>
                      </span>
                      <span className="text-[9px] text-[#5C6670]">Lossless scalable vector</span>
                    </div>
                  </button>

                  <button
                    onClick={handleExportCurveCsv}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--bg)] flex items-center gap-2 text-[#161A1D] transition-colors cursor-pointer"
                  >
                    <FileCsv weight="duotone" className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-[#161A1D] flex items-center gap-1">
                        Curve Points
                        <span className="text-[9px] font-mono px-1 rounded bg-emerald-50 text-emerald-700">
                          .csv
                        </span>
                      </span>
                      <span className="text-[9px] text-[#5C6670]">Raw (x, y) plot coordinates</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Functional Tabs */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
          <button
            onClick={() => setActiveTab('lift')}
            className={`py-1.5 sm:py-1 text-[11px] font-semibold rounded-md text-center transition-colors cursor-pointer ${
              activeTab === 'lift'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
          >
            Lift (CL-α)
          </button>
          <button
            onClick={() => setActiveTab('dragPolar')}
            className={`py-1.5 sm:py-1 text-[11px] font-semibold rounded-md text-center transition-colors cursor-pointer ${
              activeTab === 'dragPolar'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
          >
            Drag (CL-CD)
          </button>
          <button
            onClick={() => setActiveTab('pressure')}
            className={`py-1.5 sm:py-1 text-[11px] font-semibold rounded-md text-center transition-colors cursor-pointer ${
              activeTab === 'pressure'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
          >
            Cp Dist
          </button>
        </div>
      </div>

      {/* Interactive Apache ECharts Canvas */}
      <div className="w-full h-[215px] sm:h-[230px] bg-[var(--bg)] rounded-xl border border-[var(--border)] p-1.5 relative overflow-hidden">
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
