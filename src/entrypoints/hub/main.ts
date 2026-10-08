import { mount } from 'svelte';
import '@/components/base.css';
import Hub from './Hub.svelte';

mount(Hub, { target: document.getElementById('app')! });
