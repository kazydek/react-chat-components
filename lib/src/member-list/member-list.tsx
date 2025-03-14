import React, { FC, ReactNode } from "react";
import { UUIDMetadataObject, ObjectCustom } from "pubnub";
import { usePubNub } from "pubnub-react";
import { useAtom } from "jotai";
import { ThemeAtom } from "../state-atoms";
import "./member-list.scss";

export interface MemberListProps {
  children?: ReactNode;
  /** Pass a list of members, including metadata, to render on the list */
  members: UUIDMetadataObject<ObjectCustom>[] | string[];
  /** Pass a list of present member ids to mark them with a presence indicator */
  presentMembers?: string[];
  /** Provide extra actions renderer to add custom action buttons to each member */
  extraActionsRenderer?: (member: UUIDMetadataObject<ObjectCustom>) => JSX.Element;
  /** Provide custom user renderer to override themes and CSS variables. */
  memberRenderer?: (member: UUIDMetadataObject<ObjectCustom>) => JSX.Element;
}

/**
 * Renders a list of members. It can represent all users of the application, only members of
 * the current channel, users currently subscribed/present on the channel or whatever else is passed
 * into it. Custom memberRenderer can be used to modify how the users are rendered, so for example
 * presence indicators can be added.
 */
export const MemberList: FC<MemberListProps> = (props: MemberListProps) => {
  const pubnub = usePubNub();
  const [theme] = useAtom(ThemeAtom);

  /*
  /* Helper functions
  */

  const isOwnMember = (uuid: string) => {
    return pubnub.getUUID() === uuid;
  };

  const isPresentMember = (uuid: string) => {
    return props.presentMembers.includes(uuid);
  };

  const memberSorter = (a, b) => {
    if (isOwnMember(a.id)) return -1;
    if (isOwnMember(b.id)) return 1;

    if (isPresentMember(a.id) && !isPresentMember(b.id)) return -1;
    if (isPresentMember(b.id) && !isPresentMember(a.id)) return 1;

    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  };

  const memberFromString = (member: UUIDMetadataObject<ObjectCustom> | string) => {
    if (typeof member === "string") {
      return {
        id: member,
        name: member,
      };
    }
    return member;
  };

  /*
  /* Renderers
  */

  const renderMember = (member) => {
    if (props.memberRenderer) return props.memberRenderer(member);
    const youString = isOwnMember(member.id) ? "(You)" : "";

    return (
      <div key={member.id} className="pn-member">
        <div className="pn-member__avatar">
          {member.profileUrl && <img src={member.profileUrl} alt="User avatar" />}
          {!member.profileUrl && <div className="pn-member__avatar-placeholder" />}
          {isPresentMember(member.id) && <i className="pn-member__presence"></i>}
        </div>
        <div className="pn-member__main">
          <p className="pn-member__name">
            {member.name} {youString}
          </p>
          <p className="pn-member__title">{member.custom?.title}</p>
        </div>
        <div className="pn-member__actions">
          {props.extraActionsRenderer && props.extraActionsRenderer(member)}
        </div>
      </div>
    );
  };

  return (
    <div className={`pn-member-list pn-member-list--${theme}`}>
      {(props.members as string[]).map(memberFromString).sort(memberSorter).map(renderMember)}
      <>{props.children}</>
    </div>
  );
};

MemberList.defaultProps = {
  members: [],
  presentMembers: [],
};
