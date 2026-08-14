import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TEMPLATES,
  UnknownNotificationError,
  isSuppressible,
  renderNotification,
} from './notifications.js';

describe('renderNotification', () => {
  it('renders a subject, a body and a link', () => {
    const rendered = renderNotification('goalsheet.approved', {
      approverName: 'Marcus',
      sheetId: 'sheet-1',
    });

    expect(rendered.subject).toBe('Your goals have been approved');
    expect(rendered.body).toContain('Marcus');
    expect(rendered.link).toBe('/sheets/sheet-1');
  });

  it('carries the reason a sheet was returned, rather than leaving it to a follow-up', () => {
    // A sheet returned with no explanation is the failure US-305 exists to
    // fix: the employee is told to change something and not what.
    const rendered = renderNotification('goalsheet.returned', {
      managerName: 'Marcus',
      reason: 'The uptime target is below last year.',
      sheetId: 'sheet-1',
    });

    expect(rendered.body).toContain('The uptime target is below last year.');
  });

  it('refuses a type it has no template for', () => {
    // A fallback that sent "You have a notification" would deliver a message
    // with no information in it -- and unlike a failed job, nobody would
    // notice.
    expect(() => renderNotification('nothing.like.this')).toThrow(UnknownNotificationError);
    expect(() => renderNotification('nothing.like.this')).toThrow(/No template/);
  });

  it('names the offending type on the error, so a failed job says which', () => {
    try {
      renderNotification('nothing.like.this');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnknownNotificationError).type).toBe('nothing.like.this');
    }
  });

  it('renders with no data at all rather than throwing on a missing field', () => {
    // A missing field is a gap in the message; a throw here would turn it into
    // a delivery nobody gets. The empty string is visible in the result and
    // the notification still arrives.
    const rendered = renderNotification('appraisal.released');

    expect(rendered.subject).toBe('Your performance rating is available');
    expect(rendered.link).toBe('/appraisals/');
  });
});

describe('every template', () => {
  const entries = Object.entries(NOTIFICATION_TEMPLATES);

  it('there are some, so the assertions below are not vacuous', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s renders a non-empty subject, body and link', (type) => {
    const rendered = renderNotification(type, {
      daysOverdue: '3',
      employeeName: 'Priya',
      managerName: 'Marcus',
      approverName: 'Marcus',
      inviterName: 'Dana',
      organizationName: 'Aura',
      reason: 'Because.',
      note: 'A note.',
      title: 'Grow ARR',
      from: '4',
      to: '3',
    });

    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
    // Every template names where to go about it. A notification that says
    // something happened without saying where is one people learn to ignore.
    expect(rendered.link.startsWith('/')).toBe(true);
  });

  it.each(entries)('%s uses a declared category', (_type, template) => {
    expect(NOTIFICATION_CATEGORIES).toContain(template.category);
  });
});

describe('suppression', () => {
  it('lets an ordinary notification be turned off', () => {
    expect(isSuppressible('goalsheet.approved')).toBe(true);
  });

  it('refuses to let a compliance notice be turned off', () => {
    // Someone who has missed a deadline being able to silence the reminder
    // about it defeats the entire purpose of having one (US-1202).
    for (const type of Object.keys(NOTIFICATION_TEMPLATES).filter((name) =>
      name.startsWith('escalation.'),
    )) {
      expect(isSuppressible(type)).toBe(false);
    }
  });

  it('treats a released rating as mandatory', () => {
    expect(isSuppressible('appraisal.released')).toBe(false);
  });

  it('treats an unknown type as not suppressible', () => {
    // The safe direction: an unrenderable type fails loudly at dispatch, and
    // answering "yes, suppress it" here would hide that behind a preference.
    expect(isSuppressible('nothing.like.this')).toBe(false);
  });

  it('marks every compliance-category template mandatory', () => {
    for (const [type, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
      if (template.category === 'COMPLIANCE') {
        expect(template.mandatory, `${type} is compliance but suppressible`).toBe(true);
      }
    }
  });
});
