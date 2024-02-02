/*!
 * Copyright (C) 2023 Lju
 *
 * This file is part of Astra Monitor extension for GNOME Shell.
 * [https://github.com/AstraExt/astra-monitor]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import Header from '../header.js';
import Config from '../config.js';
import Utils from '../utils/utils.js';
import ProcessorMenu from './processorMenu.js';
import ProcessorGraph from './processorGraph.js';
import ProcessorBars from './processorBars.js';

type TooltipMenu = PopupMenu.PopupMenu & {
    actor: St.Widget;
};

type TooltipItem = PopupMenu.PopupMenuItem & {
    label: St.Label;
};

export default GObject.registerClass(
class ProcessorHeader extends Header {
    protected icon!: St.Icon;
    protected bars!: InstanceType<typeof ProcessorBars>;
    protected graph!: InstanceType<typeof ProcessorGraph>;
    protected percentage!: St.Label;
    
    protected tooltipMenu!: TooltipMenu;
    protected tooltipItem!: TooltipItem;
    
    constructor() {
        super('Processor Header');
        
        this.buildIcon();
        this.buildGraph();
        this.buildBars();
        this.buildPercentage();
        
        this.addOrReorderIndicators();
        
        const menu = new ProcessorMenu(this, 0.5, St.Side.TOP);
        this.setMenu(menu);
        
        Config.connect(this, 'changed::processor-indicators-order', this.addOrReorderIndicators.bind(this));
        Config.bind('processor-header-show', this, 'visible', Gio.SettingsBindFlags.GET);
        Config.connect(this, 'changed::processor-header-bars-core', this.buildBars.bind(this));
    }
    
    addOrReorderIndicators() {
        const indicators = Utils.getIndicatorsOrder('processor');
        
        let position = 0;
        for(const indicator of indicators) {
            let widget;
            switch(indicator) {
                case 'icon':
                    widget = this.icon;
                    break;
                case 'bar':
                    widget = this.bars;
                    break;
                case 'graph':
                    widget = this.graph;
                    break;
                case 'percentage':
                    widget = this.percentage;
                    break;
            }
            
            if(widget) {
                if(widget.get_parent())
                    this.remove_child(widget);
                this.insert_child_at_index(widget, position++);
            }
        }
    }
    
    buildIcon() {
        const defaultStyle = 'margin-left:2px;margin-right:4px;';
        let iconSize = Config.get_int('storage-header-icon-size');
        iconSize = Math.max(8, Math.min(30, iconSize));
        this.icon = new St.Icon({
            fallback_gicon: Utils.getLocalIcon('am-cpu-symbolic'),
            style: defaultStyle,
            icon_size: iconSize,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        
        const setIconName = () => {
            const iconCustom = Config.get_string('processor-header-icon-custom');
            if(iconCustom)
                this.icon.icon_name = iconCustom;
            else // @ts-expect-error gicon shouldn't be null, but we do have a fallback icon
                this.icon.gicon = Utils.getLocalIcon('am-cpu-symbolic');
        };
        setIconName();
        
        let baseColor = '';
        let alertColor = '';
        const alerts = new Set();
        
        const setIconBaseColor = () => {
            baseColor = Config.get_string('processor-header-icon-color') || '';
            updateIconColor();
        };
        const setIconAlertColor = () => {
            alertColor = Config.get_string('processor-header-icon-alert-color') || '';
            updateIconColor();
        };
        const updateIconColor = () => {
            if(alerts.size > 0)
                this.icon.style = defaultStyle + 'color:' + alertColor + ';';
            else if(baseColor)
                this.icon.style = defaultStyle + 'color:' + baseColor + ';';
            else
                this.icon.style = defaultStyle;
        };
        
        setIconBaseColor();
        setIconAlertColor();
        updateIconColor();
        
        Config.bind('processor-header-icon', this.icon, 'visible', Gio.SettingsBindFlags.GET);
        Config.bind('processor-header-icon-size', this.icon, 'icon_size', Gio.SettingsBindFlags.GET);
        Config.connect(this.icon, 'changed::processor-header-icon-custom', setIconName.bind(this));
        Config.connect(this.icon, 'changed::processor-header-icon-color', setIconBaseColor.bind(this));
        Config.connect(this.icon, 'changed::processor-header-icon-alert-color', setIconAlertColor.bind(this));
        
        Utils.processorMonitor.listen(this.icon, 'cpuUsage', () => {
            if(!Config.get_boolean('processor-header-icon'))
                return;
            
            const threshold = Config.get_int('processor-header-percentage-icon-alert-threshold') || 0;
            if(threshold === 0)
                return;
            
            const cpuUsage = Utils.processorMonitor.getCurrentValue('cpuUsage');
            if(!cpuUsage || !cpuUsage.total || isNaN(cpuUsage.total))
                return;
            
            if(cpuUsage.total < threshold) {
                if(alerts.has('cpuUsage')) {
                    alerts.delete('cpuUsage');
                    updateIconColor();
                }
            }
            else {
                if(!alerts.has('cpuUsage')) {
                    alerts.add('cpuUsage');
                    updateIconColor();
                }
            }
        });
    }
    
    buildBars() {
        if(this.bars) {
            this.remove_child(this.bars);
            Config.clear(this.bars);
            Utils.processorMonitor.unlisten(this.bars);
            this.bars.destroy();
        }
        
        let numBars = 1;
        const perCoreBars = Config.get_boolean('processor-header-bars-core');
        if(perCoreBars)
            numBars = Utils.processorMonitor.getNumberOfCores();
        
        this.bars = new ProcessorBars({
            numBars: numBars,
            mini: true,
            width: 0.5,
            breakdownConfig: 'processor-header-bars-breakdown'
        });
        Config.bind('processor-header-bars', this.bars, 'visible', Gio.SettingsBindFlags.GET);
        
        if(perCoreBars) {
            Utils.processorMonitor.listen(this.bars, 'cpuCoresUsage', () => {
                if(!Config.get_boolean('processor-header-bars'))
                    return;
                
                const usage = Utils.processorMonitor.getCurrentValue('cpuCoresUsage');
                const cores = Utils.processorMonitor.getNumberOfCores();
                if(!usage || !Array.isArray(usage) || usage.length < cores)
                    this.bars.setUsage([]);
                else
                    this.bars.setUsage(usage);
            });
        }
        else {
            Utils.processorMonitor.listen(this.bars, 'cpuUsage', () => {
                if(!Config.get_boolean('processor-header-bars'))
                    return;
                
                const usage = Utils.processorMonitor.getCurrentValue('cpuUsage');
                if(!usage || !usage.total || isNaN(usage.total))
                    this.bars.setUsage([]);
                else
                    this.bars.setUsage([usage]);
            });
        }
    }
    
    buildGraph() {
        if(this.graph) {
            this.remove_child(this.graph);
            Config.clear(this.graph);
            Utils.processorMonitor.unlisten(this.graph);
            this.graph.destroy();
        }
        
        let graphWidth = Config.get_int('processor-header-graph-width');
        graphWidth = Math.max(10, Math.min(500, graphWidth));
        
        this.graph = new ProcessorGraph({ width: graphWidth, mini: true, breakdownConfig: 'processor-header-graph-breakdown'});
        Config.bind('processor-header-graph', this.graph, 'visible', Gio.SettingsBindFlags.GET);
        
        Config.connect(this.graph, 'changed::processor-header-graph-width', () => {
            let graphWidth = Config.get_int('processor-header-graph-width');
            graphWidth = Math.max(10, Math.min(500, graphWidth));
            this.graph.setWidth(graphWidth);
        });
        
        Utils.processorMonitor.listen(this.graph, 'cpuUsage', () => {
            if(!Config.get_boolean('processor-header-graph'))
                return;
            const usage = Utils.processorMonitor.getUsageHistory('cpuUsage');
            this.graph.setUsageHistory(usage);
        });
    }
    
    buildPercentage() {
        const useFourDigitStyle = Config.get_boolean('processor-header-percentage-core');
        this.percentage = new St.Label({
            text: '-%',
            style_class: useFourDigitStyle ? 'astra-monitor-header-percentage4' : 'astra-monitor-header-percentage3',
            y_align: Clutter.ActorAlign.CENTER,
        });
        Config.bind('processor-header-percentage', this.percentage, 'visible', Gio.SettingsBindFlags.GET);

        Config.connect(this.percentage, 'changed::processor-header-percentage-core', () => {
            const useFourDigitStyle = Config.get_boolean('processor-header-percentage-core');
            this.percentage.style_class = useFourDigitStyle ? 'astra-monitor-header-percentage4' : 'astra-monitor-header-percentage3';
        });
        
        Utils.processorMonitor.listen(this.percentage, 'cpuUsage', () => {
            if(!Config.get_boolean('processor-header-percentage'))
                return;
            
            const cpuUsage = Utils.processorMonitor.getCurrentValue('cpuUsage');
            
            if(!cpuUsage || !cpuUsage.total || isNaN(cpuUsage.total)) {
                this.percentage.text = '0%';
                return;
            }
            
            if(Config.get_boolean('processor-header-percentage-core')) {
                const numberOfCores = Utils.processorMonitor.getNumberOfCores();
                this.percentage.text = (cpuUsage.total * numberOfCores).toFixed(0) + '%';
            }
            else {
                this.percentage.text = cpuUsage.total.toFixed(0) + '%';
            }
        });
    }
    
    update() {
        
    }
    
    createTooltip() {
        this.tooltipMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP) as TooltipMenu;
        
        Main.uiGroup.add_child(this.tooltipMenu.actor);
        this.tooltipMenu.actor.add_style_class_name('astra-monitor-tooltip-menu');
        this.tooltipMenu.actor.x_expand = true;
        this.tooltipMenu.actor.hide();
        
        this.tooltipItem = new PopupMenu.PopupMenuItem('', {
            reactive: true,
            style_class: 'astra-monitor-tooltip-item'
        }) as TooltipItem;
        this.tooltipItem.actor.x_expand = true;
        this.tooltipItem.actor.x_align = Clutter.ActorAlign.CENTER;
        this.tooltipItem.sensitive = true;
        this.tooltipMenu.addMenuItem(this.tooltipItem);
        
        Config.connect(this.tooltipMenu, 'changed::processor-header-tooltip', () => {
            if(!Config.get_boolean('processor-header-tooltip'))
                this.tooltipMenu.close(true);
        });
        
        Utils.processorMonitor.listen(this.tooltipMenu, 'cpuUsage', () => {
            if(!Config.get_boolean('processor-header-tooltip'))
                return;
            
            const cpuUsage = Utils.processorMonitor.getCurrentValue('cpuUsage');
            
            if(!cpuUsage || !cpuUsage.total || isNaN(cpuUsage.total)) {
                this.tooltipItem.label.text = '0%';
                return;
            }
            
            if(Config.get_boolean('processor-header-percentage-core')) {
                const numberOfCores = Utils.processorMonitor.getNumberOfCores();
                this.tooltipItem.label.text = (cpuUsage.total * numberOfCores).toFixed(0) + '%';
            }
            else {
                this.tooltipItem.label.text = cpuUsage.total.toFixed(0) + '%';
            }
            
            const width = this.tooltipItem.get_preferred_width(-1)[1] + 30;
            this.tooltipMenu.actor.set_width(width);
        });
    }
    
    showTooltip() {
        if(!this.tooltipMenu)
            return;
        if(!Config.get_boolean('processor-header-tooltip'))
            return;
        
        this.tooltipMenu.open(true);
    }
    
    hideTooltip() {
        if(!this.tooltipMenu)
            return;
        if(!Config.get_boolean('processor-header-tooltip'))
            return;
        this.tooltipMenu.close(true);
    }
    
    destroy() {
        Config.clear(this);
        Utils.processorMonitor.unlisten(this);
        
        Config.clear(this.icon);
        
        if(this.percentage) {
            Config.clear(this.percentage);
            Utils.processorMonitor.unlisten(this.percentage);
        }
        if(this.bars) {
            Config.clear(this.bars);
            Utils.processorMonitor.unlisten(this.bars);
        }
        if(this.graph) {
            Config.clear(this.graph);
            Utils.processorMonitor.unlisten(this.graph);
        }
        if(this.tooltipMenu) {
            Config.clear(this.tooltipMenu);
            Utils.processorMonitor.unlisten(this.tooltipMenu);
            this.tooltipMenu.close(true);
        }
        
        super.destroy();
    }
});